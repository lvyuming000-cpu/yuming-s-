import type {
  Card,
  FrameworkConfig,
  IngredientEntry,
  LibraryItem,
} from "../shared/types.js";
import { sortedSteps } from "../shared/util.js";

/* ============================================================
   系统提示拼装
   ------------------------------------------------------------
   规格 §6.1:「系统提示由配置动态拼装,不写死在代码字符串里。」

   这个文件里没有一句风味领域的知识 —— 所有内容都来自 FrameworkConfig。
   加一条规则、改一个定义、增一个步骤,都只改配置,这里不动。

   拼出来分成两块,对应 prompt caching 的两段:
   - buildFrameworkBlock():只随框架版本变化 → 打 cache_control,跨轮复用
   - buildStateBlock():每轮都变(卡片状态、库命中)→ 放在缓存断点之后
   ============================================================ */

const NL = "\n";

function numbered(lines: string[]): string {
  return lines.map((l, i) => `${i + 1}. ${l}`).join(NL);
}

function bulleted(lines: string[]): string {
  return lines.map((l) => `- ${l}`).join(NL);
}

/** 稳定块:框架知识 + 行为规则。同一框架版本内逐字节一致,可被缓存。 */
export function buildFrameworkBlock(fw: FrameworkConfig): string {
  const steps = sortedSteps(fw);

  const stepOverview = steps.map((s) => `${s.order} ${s.name}(${s.key})`).join(" · ");

  const stepDetail = steps
    .map((s) => {
      const parts = [
        `### ${s.order} ${s.name} [key=${s.key}]`,
        `引导语:${s.hint}`,
        `你的职责:${s.aiRole}`,
      ];
      if (s.checks.length) {
        parts.push(`校验规则(按顺序过):${NL}${numbered(s.checks)}`);
      }
      if (s.exitCriterion) parts.push(`收尾条件:${s.exitCriterion}`);
      return parts.join(NL);
    })
    .join(NL + NL);

  const knowledge = [...fw.sections]
    .sort((a, b) => a.order - b.order)
    .map((s) => `### ${s.title}${NL}${s.body}`)
    .join(NL + NL);

  const slots = fw.taxonomies.functionSlots.join(" / ");

  return [
    `你是「${fw.identity.title}」。${fw.identity.mission}`,
    ``,
    `## 框架`,
    fw.flowPrinciple,
    ``,
    `共 ${steps.length} 步:${stepOverview}`,
    `这 ${steps.length} 步是 ${steps.length} 个必须点亮的槽,顺序随对方,但不允许缺席。`,
    ``,
    `## 逐步职责与校验`,
    stepDetail,
    ``,
    `## 领域知识`,
    knowledge,
    ``,
    `## 功能位词表`,
    `标注原料功能时优先使用这些词:${slots}。同一原料可同时占多个功能位,拆解时标出全部。`,
    ``,
    `## 你的行为规则 — 严格执行`,
    `每轮回应必须覆盖三件事:`,
    numbered(fw.behavior.turnContract),
    ``,
    `第 ${fw.behavior.turnContract.length} 条是硬性的。每轮结尾必须落在一个可执行的动作上:给出待选项让对方选、直接提方案让对方反驳、或提议封步。`,
    ``,
    `禁止:`,
    bulleted(fw.behavior.forbidden),
    ``,
    `发散边界:`,
    bulleted(fw.behavior.divergence),
    ``,
    `起步处理:`,
    bulleted(fw.behavior.startup),
    ``,
    `封步:你认为这一步讨论到位时,主动提议封步(填 proposeConfirm),话术:`,
    `「${fw.behavior.sealingTemplate}」`,
    `对方点头才算数 —— 你只提议,不落锤。未解决项写进 unresolved,会自动进搁置项。`,
    ``,
    `语气:${fw.behavior.tone}`,
    ``,
    `## 拆解判断的可信度`,
    fw.teardown.confidenceNote,
  ].join(NL);
}

/** 参考库注入块。失败记录全量,其余按相关度(§5.2) */
export function buildLibraryBlock(
  fw: FrameworkConfig,
  injected: LibraryItem[],
  ingredientHits: IngredientEntry[],
): string {
  if (!injected.length && !ingredientHits.length) return "";

  const typeLabel = (key: string) =>
    fw.taxonomies.libraryTypes.find((t) => t.key === key)?.label ?? key;

  const parts: string[] = [];

  if (injected.length) {
    const body = injected
      .map((it) => {
        const content = it.content.slice(0, fw.retrieval.maxItemChars);
        return `[${typeLabel(it.type)}] ${it.title}${NL}${content}`;
      })
      .join(`${NL}---${NL}`);
    parts.push(
      `## 参考库命中 — 引用时必须标明来源标题${NL}${body}${NL}${NL}失败记录优先级最高:如果对方正要走进以前失败过的路,直接拦住并说明机制。`,
    );
  }

  if (ingredientHits.length) {
    const body = ingredientHits
      .map(
        (e) =>
          `- ${e.name}:在「${e.sourceCardId}」里占 ${e.functionSlots.join("+") || "未标注"},归属步骤 ${e.step},理由:${e.rationale}(${e.confidence === "confirmed" ? "已确认" : "推测"})`,
      )
      .join(NL);
    parts.push(
      `## 原料历史用法命中${NL}${body}${NL}${NL}如果对方这次的用法和历史用法功能位不同,你必须指出差异并说明风险,写进 ingredientAlerts。`,
    );
  }

  return parts.join(NL + NL);
}

/** 易变块:当前卡片状态 + 本轮库命中 */
export function buildStateBlock(
  fw: FrameworkConfig,
  card: Card,
  libraryBlock: string,
): string {
  const cat = card.categories.length
    ? card.categories
        .map((c) => fw.taxonomies.categories.find((x) => x.key === c)?.label ?? c)
        .join(" / ")
    : `未定(${fw.taxonomies.categories.map((c) => c.label).join("或")}都可能)`;

  const stepLines = sortedSteps(fw)
    .map((s) => {
      const st = card.steps[s.key] ?? { state: "empty", conclusion: "" };
      const mark =
        st.state === "confirmed" ? "已确定" : st.state === "discussing" ? "讨论中" : "空";
      return `${s.order} ${s.name}(${s.key}):【${mark}】${st.conclusion ? ` — ${st.conclusion}` : ""}`;
    })
    .join(NL);

  const pending = card.pending.filter((p) => !p.resolved);

  const lines = [
    `## 当前卡片`,
    `类型:${card.type === "teardown" ? "拆解卡(反向:从成品到结构)" : "设计卡(正向:从想法到配方)"}`,
    `名称:${card.name || "(未命名)"}`,
    `品类:${cat}`,
    `起点(原话,未修饰):${card.origin || "(无)"}`,
    ``,
    `槽位状态:`,
    stepLines,
    ``,
    `搁置项:${pending.length ? pending.map((p) => p.text).join(" / ") : "无"}`,
  ];

  if (card.type === "teardown" && card.teardown) {
    lines.push(
      ``,
      `## 拆解素材`,
      `来源:${card.teardown.sourceName || "(未填)"}`,
      `【感受】对方的主观描述:${card.teardown.perception || "(未填)"}`,
      `【原料】店家给的客观清单:${card.teardown.ingredients.join("、") || "(未填)"}`,
      `注意:两栏可信度不同,真正有价值的东西在两者的落差里。`,
    );
  }

  if (libraryBlock) lines.push(``, libraryBlock);

  return lines.join(NL);
}

/** 配方生成的系统提示 —— 同样由配置拼装 */
export function buildRecipePrompt(fw: FrameworkConfig): string {
  const invisible = fw.sections.find((s) => s.id === "invisible-function");
  return [
    buildFrameworkBlock(fw),
    ``,
    `## 本次任务`,
    `把已确定的结论整理成一份可实践的配方。输出纯文本(可用中文标题和短横线列表),包含:`,
    numbered([
      "名称与一句话概念",
      "配方 —— 每种原料写清用量,并在括号里标注它占哪些功能位(一物多用要标全)",
      "做法步骤",
      "呈现方式",
      `隐形功能提示 —— 哪些原料是「感觉不到存在」的桥接剂,不要因为尝不出来就删掉${invisible ? "" : ""}`,
      "仍未解决的问题(来自搁置项)",
    ]),
    ``,
    `不要写成报告腔。直接、可执行。只输出配方正文,不要前后寒暄。`,
  ].join(NL);
}

/** 拆解分析的系统提示 */
export function buildTeardownPrompt(fw: FrameworkConfig): string {
  const g = fw.teardown.gapLabels;
  return [
    buildFrameworkBlock(fw),
    ``,
    `## 本次任务:反向拆解`,
    `对方在外面喝到一杯东西。他给你两栏:【感受】是他的主观描述,【原料】是店家给的客观清单。`,
    `两栏可信度不同,真正有价值的东西恰恰在两者的落差里。你要做三件事:`,
    numbered([
      `对照 —— 生成落差分析,明确指出三类:${g.tastedAndListed} / ${g.listedNotTasted} / ${g.tastedNotListed}。「${g.listedNotTasted}」大概率是桥接剂或结构性成分;「${g.tastedNotListed}」是组合产生的,不是某个原料带来的。`,
      `归位 —— 按框架把每个原料放进功能位。一物多用要标全。`,
      `回答为什么好喝 —— 这是对方真正要的。不是记录成分,是搞清楚机制。`,
    ]),
    ``,
    `## 可信度标注(最重要的约束)`,
    fw.teardown.confidenceNote,
  ].join(NL);
}
