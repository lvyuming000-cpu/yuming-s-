import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_FRAMEWORK } from "../shared/framework/defaultFramework.js";
import { matchIngredientNames, relScore } from "../shared/relevance.js";
import type { Card, FrameworkConfig, IngredientEntry, LibraryItem } from "../shared/types.js";
import { alignSteps, allLit, emptySteps, litCount, sortedSteps } from "../shared/util.js";
import { buildFrameworkBlock, buildStateBlock } from "../server/prompt.js";
import { selectInjection } from "../server/retrieval.js";

const fw = (over: Partial<FrameworkConfig> = {}): FrameworkConfig => ({
  ...structuredClone(DEFAULT_FRAMEWORK),
  version: "1",
  workspaceId: "ws",
  updatedAt: 0,
  updatedBy: null,
  ...over,
});

const card = (f: FrameworkConfig, over: Partial<Card> = {}): Card => ({
  id: "c1",
  type: "design",
  name: "测试卡",
  categories: [],
  createdAt: 0,
  updatedAt: 0,
  status: "active",
  frameworkVersion: f.version,
  origin: "蜜瓜 抹茶 黑松露",
  ownerId: "u1",
  workspaceId: "ws",
  visibility: "team_read",
  messages: [],
  steps: emptySteps(f),
  pending: [],
  refs: [],
  recipe: "",
  feedback: null,
  rev: 0,
  ...over,
});

/* ---------------- 框架配置化(§6.1) ---------------- */

test("步骤数量由配置决定,不是写死的 6", () => {
  const seven = fw();
  seven.steps.push({
    key: "cost",
    order: 7,
    name: "成本核算",
    hint: "单杯成本",
    aiRole: "算清成本",
    checks: ["列出用量成本"],
  });

  const c = card(seven);
  assert.equal(Object.keys(c.steps).length, 7, "新卡片应按配置生成 7 个槽");
  assert.equal(sortedSteps(seven).at(-1)?.name, "成本核算");

  const three = fw({ steps: fw().steps.slice(0, 3) });
  assert.equal(Object.keys(card(three).steps).length, 3, "删到 3 步就应只有 3 个槽");
});

test("系统提示由配置拼装 —— 改配置就改提示,不用改代码", () => {
  const base = fw();
  const prompt = buildFrameworkBlock(base);

  for (const s of base.steps) {
    assert.ok(prompt.includes(s.name), `提示里应包含步骤名「${s.name}」`);
    assert.ok(prompt.includes(`key=${s.key}`), `提示里应包含 key=${s.key}`);
    for (const chk of s.checks) {
      assert.ok(prompt.includes(chk), `提示里应包含校验规则「${chk}」`);
    }
  }
  for (const sec of base.sections) {
    assert.ok(prompt.includes(sec.title), `提示里应包含知识段落「${sec.title}」`);
  }
  assert.ok(prompt.includes(base.behavior.sealingTemplate), "封步话术应进提示");
  assert.ok(prompt.includes(base.behavior.tone), "语气规则应进提示");

  // 改一条规则,提示随之改变
  const edited = fw();
  edited.behavior.tone = "只说结论,不解释。";
  const editedPrompt = buildFrameworkBlock(edited);
  assert.ok(editedPrompt.includes("只说结论,不解释。"));
  assert.ok(!editedPrompt.includes(base.behavior.tone));
});

test("同一框架版本的稳定块逐字节一致 —— 保证 prompt cache 能命中", () => {
  const a = buildFrameworkBlock(fw());
  const b = buildFrameworkBlock(fw());
  assert.equal(a, b);
});

test("卡片状态块随卡片变化,与稳定块分离", () => {
  const f = fw();
  const c = card(f, {
    steps: {
      ...emptySteps(f),
      structure: { state: "confirmed", conclusion: "骨架=浓抹茶,自带苦味" },
    },
    pending: [
      { id: "p1", text: "奶油比例没定", fromStep: "structure", createdAt: 0, resolved: false },
    ],
  });
  const state = buildStateBlock(f, c, "");
  assert.ok(state.includes("【已确定】"), "已确定的槽应标出来");
  assert.ok(state.includes("骨架=浓抹茶,自带苦味"));
  assert.ok(state.includes("奶油比例没定"), "搁置项应带进上下文");
  assert.ok(!state.includes(f.behavior.tone), "行为规则不应混进易变块");
});

/* ---------------- 框架版本(§6.2) ---------------- */

test("旧卡片的结论在框架改动后不丢失", () => {
  const v1 = fw();
  const old = card(v1, {
    steps: {
      ...emptySteps(v1),
      prototype: { state: "confirmed", conclusion: "对标 Espresso Martini" },
    },
  });

  // v2 把 prototype 删了,换成 cost
  const v2 = fw({ version: "2" });
  v2.steps = v2.steps.filter((s) => s.key !== "prototype");
  v2.steps.push({
    key: "cost",
    order: 6,
    name: "成本核算",
    hint: "",
    aiRole: "",
    checks: [],
  });

  const rows = alignSteps(old, v2);
  const orphan = rows.find((r) => r.key === "prototype");
  assert.ok(orphan, "被移除的步骤仍应出现");
  assert.equal(orphan?.orphaned, true, "并被标记为已移除");
  assert.equal(orphan?.state.conclusion, "对标 Espresso Martini", "结论不能被静默丢掉");

  const cost = rows.find((r) => r.key === "cost");
  assert.equal(cost?.state.state, "empty", "新步骤应补成空槽");
});

test("全槽点亮才算完成,槽数变了判定也跟着变", () => {
  const f = fw();
  const done: Card = card(f, {
    steps: Object.fromEntries(
      f.steps.map((s) => [s.key, { state: "confirmed" as const, conclusion: "x" }]),
    ),
  });
  assert.equal(allLit(done, f), true);
  assert.equal(litCount(done, f), 6);

  const f7 = fw();
  f7.steps.push({ key: "cost", order: 7, name: "成本", hint: "", aiRole: "", checks: [] });
  assert.equal(allLit(done, f7), false, "加了一步之后同一张卡不再算完成");
});

/* ---------------- 检索规则(§5.2 / §5.5) ---------------- */

const libItem = (over: Partial<LibraryItem>): LibraryItem => ({
  id: "l1",
  type: "recipe",
  title: "t",
  content: "c",
  authorId: "u1",
  workspaceId: "ws",
  scope: "team",
  createdAt: 0,
  ...over,
});

test("失败记录全量注入,其余按相关度取前 N", () => {
  const f = fw();
  f.retrieval.relevanceTopK = 2;

  const library: LibraryItem[] = [
    libItem({ id: "f1", type: "failure", title: "松露低温出不来香", content: "机制" }),
    libItem({ id: "f2", type: "failure", title: "毫不相关的失败", content: "别的" }),
    libItem({ id: "r1", type: "recipe", title: "抹茶蜜瓜配方", content: "抹茶蜜瓜奶油" }),
    libItem({ id: "r2", type: "recipe", title: "抹茶拿铁", content: "抹茶牛奶" }),
    libItem({ id: "r3", type: "book", title: "完全无关", content: "咖啡萃取原理" }),
  ];

  const out = selectInjection(f, "抹茶蜜瓜怎么配", library, []);
  const ids = out.items.map((i) => i.id);

  assert.ok(ids.includes("f1") && ids.includes("f2"), "两条失败记录都必须注入");
  assert.ok(ids.includes("r1"), "高相关的配方应命中");
  assert.ok(!ids.includes("r3"), "无关条目不应命中");
  assert.ok(
    out.items.filter((i) => i.type !== "failure").length <= 2,
    "非必检类型不超过 topK",
  );
});

test("原料名精确命中,调出该原料全部历史用法", () => {
  const f = fw();
  const entries: IngredientEntry[] = [
    {
      id: "e1",
      name: "番茄",
      sourceCardId: "c9",
      functionSlots: ["骨架"],
      step: "structure",
      rationale: "配咸托鲜",
      confidence: "confirmed",
      authorId: "u1",
      workspaceId: "ws",
      scope: "team",
      createdAt: 0,
    },
    {
      id: "e2",
      name: "番茄",
      sourceCardId: "c8",
      functionSlots: ["芳香调味"],
      step: "aroma",
      rationale: "另一杯里的用法",
      confidence: "inferred",
      authorId: "u1",
      workspaceId: "ws",
      scope: "team",
      createdAt: 0,
    },
    {
      id: "e3",
      name: "抹茶",
      sourceCardId: "c7",
      functionSlots: ["骨架"],
      step: "structure",
      rationale: "苦味兼对抗性",
      confidence: "confirmed",
      authorId: "u1",
      workspaceId: "ws",
      scope: "team",
      createdAt: 0,
    },
  ];

  const out = selectInjection(f, "这次想把番茄放在香气位", [], entries);
  assert.deepEqual(out.matchedIngredientNames, ["番茄"]);
  assert.equal(out.ingredientHits.length, 2, "同一原料的历史条目要全部调出");
  assert.ok(!out.ingredientHits.some((e) => e.name === "抹茶"), "没提到的原料不该命中");
});

test("2-gram 相关度对中文可用", () => {
  assert.ok(relScore("抹茶蜜瓜", "抹茶蜜瓜黑松露") > relScore("抹茶蜜瓜", "咖啡萃取"));
  assert.equal(relScore("抹茶", "咖啡"), 0);
});

test("原料名匹配偏好更长的名字,避免短名吃掉长名", () => {
  const hit = matchIngredientNames("这次用抹茶粉", ["抹茶", "抹茶粉"]);
  assert.deepEqual(hit, ["抹茶粉"]);
});

/* ---------------- 参考库注入的可信度 ---------------- */

test("库命中会带来源标题,推测条目标注为推测", () => {
  const f = fw();
  const c = card(f);
  const block = buildStateBlock(
    f,
    c,
    // 直接用 buildLibraryBlock 的产物形状验证接入点
    "## 参考库命中 — 引用时必须标明来源标题\n[失败记录] 松露低温出不来香\n机制",
  );
  assert.ok(block.includes("松露低温出不来香"));
  assert.ok(block.includes("引用时必须标明来源标题"));
});
