import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
// SDK 的 zodOutputFormat 走 zod v4 接口(zod 3.25+ 以 zod/v4 子路径提供)
import * as z from "zod/v4";
import type {
  Card,
  FrameworkConfig,
  IngredientEntry,
  LibraryItem,
  Message,
  TeardownResult,
  TurnResult,
} from "../shared/types.js";
import { sortedSteps } from "../shared/util.js";
import {
  buildFrameworkBlock,
  buildLibraryBlock,
  buildRecipePrompt,
  buildStateBlock,
  buildTeardownPrompt,
} from "./prompt.js";

/* ============================================================
   Anthropic 调用层
   ------------------------------------------------------------
   - 模型:claude-opus-5
   - 结构化输出:output_config.format + zod schema,schema 由框架配置
     动态生成(步骤 key 是 enum,加一步就多一个合法值)。
     原型里那套「让模型返回 JSON 字符串再手写解析器」的做法已删除 ——
     那是 API 没有结构化输出时的产物。
   - Prompt caching:system 拆成两块,框架块打 cache_control,
     卡片状态块放在断点之后。同一框架版本内跨轮命中缓存。
   ============================================================ */

const MODEL = process.env.ANTHROPIC_MODEL ?? "claude-opus-5";
const EFFORT = (process.env.ANTHROPIC_EFFORT ?? "high") as
  | "low"
  | "medium"
  | "high"
  | "xhigh"
  | "max";
const MAX_TOKENS = Number(process.env.ANTHROPIC_MAX_TOKENS ?? 16000);
/** 送进模型的历史轮数上限 */
const HISTORY_TURNS = Number(process.env.HISTORY_TURNS ?? 16);

let cached: Anthropic | null = null;
function client(): Anthropic {
  if (!cached) cached = new Anthropic();
  return cached;
}

export function aiConfigured(): boolean {
  return Boolean(
    process.env.ANTHROPIC_API_KEY ||
      process.env.ANTHROPIC_AUTH_TOKEN ||
      process.env.ANTHROPIC_PROFILE,
  );
}

/* ---------------- 动态 schema ---------------- */

function stepEnum(fw: FrameworkConfig) {
  const keys = sortedSteps(fw).map((s) => s.key);
  if (!keys.length) throw new Error("框架里一个步骤都没有,无法推演");
  return z.enum(keys as [string, ...string[]]);
}

function turnSchema(fw: FrameworkConfig) {
  const step = stepEnum(fw);
  const slot = z.string();
  return z.object({
    reply: z
      .string()
      .describe("回应正文。中文。可用换行分段。写得像对话,不是像报告。"),
    currentStep: step.describe("当前所在步骤的 key"),
    discussing: z.array(step).describe("本轮进入讨论中的步骤 key,没有就空数组"),
    proposeConfirm: z
      .object({
        step: step,
        conclusion: z.string().describe("这一步的结论,一到三句"),
        unresolved: z
          .string()
          .describe("还没定但不影响往下走的东西,没有就填空字符串"),
      })
      .nullable()
      .describe("认为这一步可以封了才填,否则填 null"),
    newPending: z.array(z.string()).describe("本轮提出但没解决的问题,没有就空数组"),
    sourcesUsed: z.array(z.string()).describe("本轮引用到的参考库条目标题,没有就空数组"),
    ingredientAlerts: z
      .array(z.string())
      .describe(
        "原料级主动提示:对方提到的原料在库里有历史用法且这次用法不同,写明差异和风险。没有就空数组",
      ),
    suggestName: z
      .string()
      .describe("卡片还没有名字时给一个简短的名字,否则填空字符串"),
    suggestCategories: z
      .array(z.enum(fw.taxonomies.categories.map((c) => c.key) as [string, ...string[]]))
      .describe("品类未定且你能判断时填,否则空数组"),
    ingredientsExtracted: z
      .array(
        z.object({
          name: z.string().describe("原料名,如「番茄」「抹茶」"),
          step: step,
          functionSlots: z.array(slot).describe("在这杯里占的功能位,多标签"),
          rationale: z.string().describe("为什么这样用成立"),
          confidence: z.enum(["confirmed", "inferred"]),
        }),
      )
      .describe(
        "本轮明确落定的原料及其功能位。只写已经谈定的,没有就空数组 —— 这些会进原料知识库,猜测会被放大。",
      ),
  });
}

function teardownSchema(fw: FrameworkConfig) {
  const step = stepEnum(fw);
  return z.object({
    gapAnalysis: z.object({
      tastedAndListed: z.array(z.string()),
      listedNotTasted: z.array(z.string()).describe("清单里有但没尝出来 —— 高价值"),
      tastedNotListed: z.array(z.string()).describe("尝到了但清单里没有 —— 高价值"),
    }),
    placements: z.array(
      z.object({
        ingredient: z.string(),
        step: step,
        functionSlots: z.array(z.string()),
        rationale: z.string(),
        confidence: z.enum(["confirmed", "inferred"]),
      }),
    ),
    whyItWorks: z.string().describe("为什么好喝 —— 讲机制,不是列成分"),
    whyItWorksConfidence: z.enum(["confirmed", "inferred"]),
    borrowable: z.string().describe("可借用/可学习的部分"),
  });
}

/* ---------------- system 组装(带缓存断点) ---------------- */

function systemBlocks(frameworkText: string, stateText: string) {
  return [
    {
      type: "text" as const,
      text: frameworkText,
      // 稳定前缀:同一框架版本内逐字节一致,跨轮复用
      cache_control: { type: "ephemeral" as const },
    },
    { type: "text" as const, text: stateText },
  ];
}

function history(messages: Message[]) {
  return messages.slice(-HISTORY_TURNS).map((m) => ({
    role: m.role,
    content: m.content,
  }));
}

/* ---------------- 对话推演 ---------------- */

export async function runTurn(args: {
  fw: FrameworkConfig;
  card: Card;
  injectedLibrary: LibraryItem[];
  ingredientHits: IngredientEntry[];
}): Promise<TurnResult> {
  const { fw, card, injectedLibrary, ingredientHits } = args;
  const libBlock = buildLibraryBlock(fw, injectedLibrary, ingredientHits);

  const response = await client().messages.parse({
    model: MODEL,
    max_tokens: MAX_TOKENS,
    system: systemBlocks(
      buildFrameworkBlock(fw),
      buildStateBlock(fw, card, libBlock),
    ),
    output_config: {
      effort: EFFORT,
      format: zodOutputFormat(turnSchema(fw)),
    },
    messages: history(card.messages),
  });

  if (response.stop_reason === "refusal") {
    throw new AIRefusal(response.stop_details?.explanation ?? "");
  }
  const parsed = response.parsed_output;
  if (!parsed) throw new Error("模型没有返回可解析的结构化结果");
  return parsed as TurnResult;
}

/* ---------------- 配方生成 ---------------- */

export async function generateRecipe(args: {
  fw: FrameworkConfig;
  card: Card;
}): Promise<string> {
  const { fw, card } = args;

  const stepText = sortedSteps(fw)
    .map(
      (s) =>
        `${s.order} ${s.name}:${card.steps[s.key]?.conclusion || "(未确定)"}`,
    )
    .join("\n");

  const pending = card.pending.filter((p) => !p.resolved).map((p) => p.text);

  const msg = [
    `卡片:${card.name || "(未命名)"}`,
    `品类:${card.categories.join("/") || "未定"}`,
    `起点:${card.origin}`,
    ``,
    `各步结论:`,
    stepText,
    ``,
    `搁置项:${pending.join(" / ") || "无"}`,
  ].join("\n");

  // 输出可能较长,走流式避免 HTTP 超时
  const stream = client().messages.stream({
    model: MODEL,
    max_tokens: MAX_TOKENS,
    system: [
      {
        type: "text",
        text: buildRecipePrompt(fw),
        cache_control: { type: "ephemeral" },
      },
    ],
    output_config: { effort: EFFORT },
    messages: [{ role: "user", content: msg }],
  });
  const final = await stream.finalMessage();
  if (final.stop_reason === "refusal") {
    throw new AIRefusal(final.stop_details?.explanation ?? "");
  }
  return final.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("\n")
    .trim();
}

/* ---------------- 拆解分析 ---------------- */

export async function analyzeTeardown(args: {
  fw: FrameworkConfig;
  card: Card;
  injectedLibrary: LibraryItem[];
  ingredientHits: IngredientEntry[];
}): Promise<TeardownResult> {
  const { fw, card, injectedLibrary, ingredientHits } = args;
  const td = card.teardown;
  if (!td) throw new Error("这不是一张拆解卡");

  const libBlock = buildLibraryBlock(fw, injectedLibrary, ingredientHits);

  const msg = [
    `来源:${td.sourceName || "(未填)"}`,
    ``,
    `【感受】(主观,对方自己说的):`,
    td.perception || "(未填)",
    ``,
    `【原料】(客观,店家给的清单):`,
    td.ingredients.map((i) => `- ${i}`).join("\n") || "(未填)",
  ].join("\n");

  const response = await client().messages.parse({
    model: MODEL,
    max_tokens: MAX_TOKENS,
    system: systemBlocks(
      buildTeardownPrompt(fw),
      buildStateBlock(fw, card, libBlock),
    ),
    output_config: {
      effort: EFFORT,
      format: zodOutputFormat(teardownSchema(fw)),
    },
    messages: [{ role: "user", content: msg }],
  });

  if (response.stop_reason === "refusal") {
    throw new AIRefusal(response.stop_details?.explanation ?? "");
  }
  const parsed = response.parsed_output;
  if (!parsed) throw new Error("模型没有返回可解析的结构化结果");
  return parsed as TeardownResult;
}

/* ---------------- 联网情报(§5.3) ---------------- */

export interface IntelResult {
  title: string;
  content: string;
  sources: string[];
}

export async function researchIntel(args: {
  fw: FrameworkConfig;
  query: string;
}): Promise<IntelResult> {
  const { fw, query } = args;

  const stream = client().messages.stream({
    model: MODEL,
    max_tokens: MAX_TOKENS,
    system: [
      {
        type: "text",
        text: [
          buildFrameworkBlock(fw),
          ``,
          `## 本次任务:联网调研`,
          `搜索并转述公开信息,产出一条能沉淀进参考库的情报条目。`,
          `版权限制:只转述公开信息,不逐字引用书籍或文章原文。`,
          `格式:第一行是一句话标题(不超过 20 字,不加标点前缀),空一行,然后是正文。`,
          `正文要能被将来的设计讨论直接调用 —— 写结论和机制,不要写「我搜索了…」这类过程。`,
        ].join("\n"),
        cache_control: { type: "ephemeral" },
      },
    ],
    output_config: { effort: EFFORT },
    tools: [{ type: "web_search_20260209", name: "web_search", max_uses: 8 }],
    messages: [{ role: "user", content: query }],
  });

  const final = await stream.finalMessage();
  if (final.stop_reason === "refusal") {
    throw new AIRefusal(final.stop_details?.explanation ?? "");
  }

  const text = final.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("\n")
    .trim();

  const sources: string[] = [];
  for (const block of final.content) {
    if (block.type === "web_search_tool_result") {
      const c = block.content as unknown;
      // 成功时 content 是数组,出错时是单个错误对象 —— 先判形状
      if (Array.isArray(c)) {
        for (const r of c) {
          if (r && typeof r === "object" && "url" in r) sources.push(String(r.url));
        }
      }
    }
  }

  const [firstLine, ...rest] = text.split("\n");
  const title = (firstLine || query).replace(/^#+\s*/, "").slice(0, 40);
  const body = rest.join("\n").trim() || text;

  return { title, content: body, sources: [...new Set(sources)] };
}

/* ---------------- 错误类型 ---------------- */

export class AIRefusal extends Error {
  constructor(public explanation: string) {
    super("模型拒绝了这次请求");
    this.name = "AIRefusal";
  }
}
