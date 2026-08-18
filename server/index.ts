// 必须第一个 import:先把 .env 灌进 process.env,再让其他模块读它
import "./env.js";
import express from "express";
import fs from "node:fs";
import path from "node:path";
import { relScore } from "../shared/relevance.js";
import type {
  Card,
  CardType,
  FrameworkConfig,
  Feedback,
  IngredientEntry,
  InputMode,
  LibraryItem,
  LibraryScope,
  Message,
  PendingItem,
  SearchResults,
  StepKey,
  Visibility,
} from "../shared/types.js";
import { canEdit, canRead, emptySteps, sortedSteps, uid } from "../shared/util.js";
import { AIRefusal, aiConfigured, analyzeTeardown, generateRecipe, researchIntel, runTurn } from "./ai.js";
import { requireAuth, requireRole, type AuthedRequest } from "./auth.js";
import { selectInjection } from "./retrieval.js";
import {
  cards,
  flush,
  frameworks,
  ingredients,
  library,
  loadSync,
  sessions,
  users,
  workspaces,
} from "./store.js";
import { sttConfig, transcribe } from "./stt.js";

loadSync();

const app = express();
app.use(express.json({ limit: "4mb" }));

const PORT = Number(process.env.PORT ?? 8787);

/** Express 5 把路径参数标成 string | string[];这里统一收敛成 string */
function param(req: express.Request, name: string): string {
  const v = req.params[name];
  return Array.isArray(v) ? (v[0] ?? "") : (v ?? "");
}

/* ============================================================
   能力探测 —— 前端据此决定显示哪些入口
   ============================================================ */

app.get("/api/config", (_req, res) => {
  res.json({
    ai: aiConfigured(),
    serverStt: Boolean(sttConfig()),
  });
});

/* ============================================================
   身份与团队(§6.4)
   ============================================================ */

app.post("/api/auth/session", (req, res) => {
  const email = String(req.body?.email ?? "").trim();
  const name = String(req.body?.name ?? "").trim();
  if (!email) {
    res.status(400).json({ error: "需要邮箱" });
    return;
  }
  const user = users.byEmail(email) ?? users.create(email, name || email.split("@")[0]);

  let ws = workspaces.forUser(user.id)[0];
  if (!ws) {
    const wsName = String(req.body?.workspaceName ?? "").trim() || `${user.name} 的工作台`;
    ws = workspaces.create(wsName, user.id);
  }

  const session = sessions.create(user.id, ws.id);
  res.json({
    user,
    workspace: ws,
    role: workspaces.roleOf(ws.id, user.id),
    token: session.token,
  });
});

app.post("/api/auth/logout", requireAuth, (req: AuthedRequest, res) => {
  sessions.revoke(req.auth!.token);
  res.json({ ok: true });
});

app.get("/api/auth/me", requireAuth, (req: AuthedRequest, res) => {
  const { user, workspace, role, token } = req.auth!;
  res.json({ user, workspace, role, token });
});

app.get("/api/workspace/members", requireAuth, (req: AuthedRequest, res) => {
  const ws = req.auth!.workspace;
  res.json(
    ws.members.map((m) => ({
      ...m,
      user: users.byId(m.userId),
    })),
  );
});

app.post(
  "/api/workspace/members",
  requireAuth,
  requireRole("admin"),
  (req: AuthedRequest, res) => {
    const email = String(req.body?.email ?? "").trim();
    const role = (req.body?.role ?? "editor") as "admin" | "editor" | "viewer";
    if (!email) {
      res.status(400).json({ error: "需要邮箱" });
      return;
    }
    const user =
      users.byEmail(email) ?? users.create(email, email.split("@")[0]);
    const ws = workspaces.addMember(req.auth!.workspace.id, user.id, role);
    res.json({ ok: true, workspace: ws });
  },
);

/* ============================================================
   框架配置(§6.1 / §6.2)
   ============================================================ */

app.get("/api/framework", requireAuth, (req: AuthedRequest, res) => {
  res.json(frameworks.current(req.auth!.workspace.id));
});

app.get("/api/framework/versions", requireAuth, (req: AuthedRequest, res) => {
  const list = frameworks.versions(req.auth!.workspace.id).map((f) => ({
    version: f.version,
    label: f.label,
    updatedAt: f.updatedAt,
    updatedBy: f.updatedBy,
    stepCount: f.steps.length,
  }));
  res.json(list);
});

app.get("/api/framework/:version", requireAuth, (req: AuthedRequest, res) => {
  const fw = frameworks.get(req.auth!.workspace.id, param(req, "version"));
  if (!fw) {
    res.status(404).json({ error: "没有这个框架版本" });
    return;
  }
  res.json(fw);
});

/** 保存框架 = 生成新版本。改定义、加规则、增删步骤都走这里,不用改代码。 */
app.put(
  "/api/framework",
  requireAuth,
  requireRole("admin", "editor"),
  (req: AuthedRequest, res) => {
    const body = req.body as Partial<FrameworkConfig>;
    const error = validateFramework(body);
    if (error) {
      res.status(400).json({ error });
      return;
    }
    const { version, workspaceId, updatedAt, updatedBy, ...rest } =
      body as FrameworkConfig;
    const saved = frameworks.save(
      req.auth!.workspace.id,
      rest as Omit<FrameworkConfig, "version" | "workspaceId" | "updatedAt" | "updatedBy">,
      req.auth!.user.id,
    );
    res.json(saved);
  },
);

function validateFramework(fw: Partial<FrameworkConfig>): string | null {
  if (!fw || typeof fw !== "object") return "框架内容不是对象";
  if (!Array.isArray(fw.steps) || fw.steps.length === 0)
    return "步骤列表不能为空 —— 至少要有一步";
  const keys = new Set<string>();
  for (const s of fw.steps) {
    if (!s.key || typeof s.key !== "string") return "每个步骤都要有 key";
    if (!/^[a-z0-9_-]+$/i.test(s.key))
      return `步骤 key「${s.key}」只能用字母、数字、下划线、连字符`;
    if (keys.has(s.key)) return `步骤 key 重复:${s.key}`;
    keys.add(s.key);
    if (!s.name) return `步骤 ${s.key} 没有名称`;
    if (typeof s.order !== "number") return `步骤 ${s.key} 没有序号`;
    if (!Array.isArray(s.checks)) return `步骤 ${s.key} 的校验规则必须是数组`;
  }
  if (!Array.isArray(fw.sections)) return "知识段落必须是数组";
  if (!fw.behavior || !Array.isArray(fw.behavior.turnContract))
    return "行为规则缺失";
  if (!fw.taxonomies || !Array.isArray(fw.taxonomies.categories))
    return "品类词表缺失";
  if (!Array.isArray(fw.taxonomies.libraryTypes) || !fw.taxonomies.libraryTypes.length)
    return "参考库类型不能为空";
  if (!fw.taxonomies.libraryTypes.some((t) => t.retrieval === "always"))
    return "至少要有一类参考库是「每轮必检」—— 失败记录漏掉代价最大";
  if (!fw.retrieval || typeof fw.retrieval.relevanceTopK !== "number")
    return "检索配置缺失";
  if (!fw.teardown?.gapLabels) return "拆解配置缺失";
  if (!fw.identity?.title) return "引擎身份缺失";
  return null;
}

/* ============================================================
   卡片
   ============================================================ */

type LoadResult =
  | { ok: false; status: 404 | 403; message: string }
  | { ok: true; card: Card; writable: boolean };

function loadCard(req: AuthedRequest, id: string): LoadResult {
  const card = cards.byId(id);
  if (!card) return { ok: false, status: 404, message: "卡片不存在" };
  const { user, workspace, role } = req.auth!;
  if (card.workspaceId !== workspace.id)
    return { ok: false, status: 404, message: "卡片不存在" };
  if (!canRead(card, user.id))
    return { ok: false, status: 403, message: "无权查看这张卡" };
  return { ok: true, card, writable: canEdit(card, user.id, role) };
}

app.get("/api/cards", requireAuth, (req: AuthedRequest, res) => {
  const { user, workspace } = req.auth!;
  const list = cards
    .visibleTo(workspace.id, user.id)
    .sort((a, b) => b.updatedAt - a.updatedAt);
  res.json(list);
});

app.post("/api/cards", requireAuth, requireRole("admin", "editor"), (req: AuthedRequest, res) => {
  const { user, workspace } = req.auth!;
  const fw = frameworks.current(workspace.id);
  const type = (req.body?.type === "teardown" ? "teardown" : "design") as CardType;
  const origin = String(req.body?.origin ?? "").trim();
  const inputMode = (req.body?.inputMode === "voice" ? "voice" : "text") as InputMode;
  const visibility = (["private", "team_read", "team_edit"] as Visibility[]).includes(
    req.body?.visibility,
  )
    ? (req.body.visibility as Visibility)
    : "team_read";

  const card: Card = {
    id: uid(),
    type,
    name: String(req.body?.name ?? "").trim(),
    categories: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
    status: "active",
    frameworkVersion: fw.version,
    origin,
    originInputMode: inputMode,
    ownerId: user.id,
    workspaceId: workspace.id,
    visibility,
    messages: [],
    steps: emptySteps(fw),
    pending: [],
    refs: [],
    recipe: "",
    feedback: null,
    rev: 0,
    ...(type === "teardown"
      ? {
          teardown: {
            sourceName: String(req.body?.sourceName ?? "").trim(),
            perception: origin,
            perceptionInputMode: inputMode,
            ingredients: [],
            gapAnalysis: null,
            placements: [],
            whyItWorks: "",
            whyItWorksConfidence: "inferred" as const,
            borrowable: "",
          },
        }
      : {}),
  };

  cards.insert(card);
  res.status(201).json(card);
});

app.get("/api/cards/:id", requireAuth, (req: AuthedRequest, res) => {
  const r = loadCard(req, param(req, "id"));
  if (!r.ok) {
    res.status(r.status).json({ error: r.message });
    return;
  }
  res.json(r.card);
});

/** 局部更新。必须带 rev,过期写回 409(多人接力同一张卡) */
app.patch("/api/cards/:id", requireAuth, (req: AuthedRequest, res) => {
  const r = loadCard(req, param(req, "id"));
  if (!r.ok) {
    res.status(r.status).json({ error: r.message });
    return;
  }
  if (!r.writable) {
    res.status(403).json({ error: "这张卡对你只读" });
    return;
  }
  const rev = Number(req.body?.rev);
  if (!Number.isInteger(rev)) {
    res.status(400).json({ error: "缺少 rev" });
    return;
  }

  const patch = (req.body?.patch ?? {}) as Partial<Card>;
  const allowed: (keyof Card)[] = [
    "name",
    "categories",
    "status",
    "visibility",
    "pending",
    "teardown",
    "steps",
  ];
  const next: Card = { ...r.card };
  for (const key of allowed) {
    if (key in patch) (next as unknown as Record<string, unknown>)[key] = patch[key];
  }

  const saved = cards.update(next, rev);
  if (!saved) {
    res.status(409).json({ error: "这张卡已被其他人改过,先刷新再改", card: cards.byId(param(req, "id")) });
    return;
  }
  res.json(saved);
});

app.delete("/api/cards/:id", requireAuth, (req: AuthedRequest, res) => {
  const r = loadCard(req, param(req, "id"));
  if (!r.ok) {
    res.status(r.status).json({ error: r.message });
    return;
  }
  if (r.card.ownerId !== req.auth!.user.id && req.auth!.role !== "admin") {
    res.status(403).json({ error: "只有卡片所有者或管理员能删除" });
    return;
  }
  ingredients.removeByCard(r.card.id);
  cards.remove(r.card.id);
  res.json({ ok: true });
});

/* ---------------- 对话推演 ---------------- */

app.post("/api/cards/:id/turn", requireAuth, async (req: AuthedRequest, res) => {
  const r = loadCard(req, param(req, "id"));
  if (!r.ok) {
    res.status(r.status).json({ error: r.message });
    return;
  }
  if (!r.writable) {
    res.status(403).json({ error: "这张卡对你只读" });
    return;
  }
  if (!aiConfigured()) {
    res.status(503).json({ error: "服务端没有配置 ANTHROPIC_API_KEY,推演不可用" });
    return;
  }

  const text = String(req.body?.text ?? "").trim();
  if (!text) {
    res.status(400).json({ error: "内容为空" });
    return;
  }
  const inputMode = (req.body?.inputMode === "voice" ? "voice" : "text") as InputMode;
  const { user, workspace } = req.auth!;

  // 卡片按它自己的框架版本推演 —— 团队改了框架不会让进行中的卡片换规则
  const fw =
    frameworks.get(workspace.id, r.card.frameworkVersion) ??
    frameworks.current(workspace.id);

  const userMsg: Message = {
    id: uid(),
    role: "user",
    content: text,
    ts: Date.now(),
    authorId: user.id,
    inputMode,
  };

  const isFirst = r.card.messages.length === 0;
  const base: Card = {
    ...r.card,
    origin: isFirst && !r.card.origin ? text : r.card.origin,
    originInputMode: isFirst && !r.card.origin ? inputMode : r.card.originInputMode,
    messages: [...r.card.messages, userMsg],
  };

  const injection = selectInjection(
    fw,
    text,
    library.visibleTo(workspace.id, user.id),
    ingredients.visibleTo(workspace.id, user.id),
  );

  try {
    const out = await runTurn({
      fw,
      card: base,
      injectedLibrary: injection.items,
      ingredientHits: injection.ingredientHits,
    });

    const next: Card = { ...base, steps: { ...base.steps } };

    const assistantMsg: Message = {
      id: uid(),
      role: "assistant",
      content: out.reply,
      ts: Date.now(),
      sources: out.sourcesUsed ?? [],
      ingredientAlerts: out.ingredientAlerts ?? [],
    };
    next.messages = [...base.messages, assistantMsg];

    // 点亮讨论中的槽 —— 已确定的不回退
    const touch = new Set<StepKey>([...(out.discussing ?? [])]);
    if (out.currentStep) touch.add(out.currentStep);
    for (const key of touch) {
      const st = next.steps[key];
      if (st && st.state === "empty") next.steps[key] = { ...st, state: "discussing" };
    }

    if (out.newPending?.length) {
      const existing = new Set(next.pending.map((p) => p.text));
      const fresh: PendingItem[] = out.newPending
        .filter((t) => t && !existing.has(t))
        .map((t) => ({
          id: uid(),
          text: t,
          fromStep: out.currentStep ?? sortedSteps(fw)[0]?.key ?? "",
          createdAt: Date.now(),
          resolved: false,
        }));
      next.pending = [...next.pending, ...fresh];
    }

    if (out.sourcesUsed?.length) {
      const ids = out.sourcesUsed
        .map((title) =>
          injection.items.find((i) => i.title === title)?.id ?? null,
        )
        .filter((x): x is string => Boolean(x));
      next.refs = [...new Set([...next.refs, ...ids])];
    }

    if (!next.name && out.suggestName) next.name = out.suggestName;
    if (!next.categories.length && out.suggestCategories?.length) {
      const valid = new Set(fw.taxonomies.categories.map((c) => c.key));
      next.categories = out.suggestCategories.filter((c) => valid.has(c));
    }

    // 原料级索引回流(§5.4)
    for (const ing of out.ingredientsExtracted ?? []) {
      if (!ing.name?.trim()) continue;
      ingredients.upsert({
        id: uid(),
        name: ing.name.trim(),
        sourceCardId: next.id,
        functionSlots: ing.functionSlots ?? [],
        step: ing.step,
        rationale: ing.rationale ?? "",
        confidence: ing.confidence === "confirmed" ? "confirmed" : "inferred",
        authorId: user.id,
        workspaceId: workspace.id,
        scope: next.visibility === "private" ? "personal" : "team",
        createdAt: Date.now(),
      });
    }

    const saved = cards.update(next, r.card.rev);
    if (!saved) {
      res.status(409).json({ error: "这张卡刚被其他人改过,刷新后重发这一句" });
      return;
    }

    res.json({
      card: saved,
      proposeConfirm: out.proposeConfirm ?? null,
      currentStep: out.currentStep ?? null,
      ingredientAlerts: out.ingredientAlerts ?? [],
      injectedSources: injection.items.map((i) => ({ id: i.id, title: i.title, type: i.type })),
      matchedIngredients: injection.matchedIngredientNames,
    });
  } catch (e) {
    handleAIError(e, res);
  }
});

/** 封步 —— AI 提议、用户拍板,双重确认(§3.5) */
app.post("/api/cards/:id/confirm", requireAuth, (req: AuthedRequest, res) => {
  const r = loadCard(req, param(req, "id"));
  if (!r.ok) {
    res.status(r.status).json({ error: r.message });
    return;
  }
  if (!r.writable) {
    res.status(403).json({ error: "这张卡对你只读" });
    return;
  }
  const step = String(req.body?.step ?? "");
  const conclusion = String(req.body?.conclusion ?? "").trim();
  const unresolved = String(req.body?.unresolved ?? "").trim();
  if (!step || !(step in r.card.steps)) {
    res.status(400).json({ error: "步骤不存在" });
    return;
  }

  const next: Card = { ...r.card, steps: { ...r.card.steps } };
  next.steps[step] = {
    state: "confirmed",
    conclusion,
    confirmedAt: Date.now(),
    confirmedBy: req.auth!.user.id,
  };
  if (unresolved) {
    next.pending = [
      ...next.pending,
      {
        id: uid(),
        text: unresolved,
        fromStep: step,
        createdAt: Date.now(),
        resolved: false,
      },
    ];
  }

  const saved = cards.update(next, r.card.rev);
  if (!saved) {
    res.status(409).json({ error: "这张卡已被其他人改过,先刷新" });
    return;
  }
  res.json(saved);
});

/* ---------------- 配方与反馈 ---------------- */

app.post("/api/cards/:id/recipe", requireAuth, async (req: AuthedRequest, res) => {
  const r = loadCard(req, param(req, "id"));
  if (!r.ok) {
    res.status(r.status).json({ error: r.message });
    return;
  }
  if (!r.writable) {
    res.status(403).json({ error: "这张卡对你只读" });
    return;
  }
  if (!aiConfigured()) {
    res.status(503).json({ error: "服务端没有配置 ANTHROPIC_API_KEY" });
    return;
  }

  const { workspace } = req.auth!;
  const fw =
    frameworks.get(workspace.id, r.card.frameworkVersion) ??
    frameworks.current(workspace.id);

  // 六槽全亮才能导出配方(§2.2)
  const unlit = sortedSteps(fw).filter(
    (s) => r.card.steps[s.key]?.state !== "confirmed",
  );
  if (unlit.length) {
    res.status(400).json({
      error: `还有 ${unlit.length} 个槽没点亮:${unlit.map((s) => s.name).join("、")}`,
    });
    return;
  }

  try {
    const recipe = await generateRecipe({ fw, card: r.card });
    const saved = cards.update({ ...r.card, recipe }, r.card.rev);
    if (!saved) {
      res.status(409).json({ error: "这张卡已被其他人改过,先刷新" });
      return;
    }
    res.json(saved);
  } catch (e) {
    handleAIError(e, res);
  }
});

/** 实践反馈 —— 「为什么」比评分重要,失败机制自动回流参考库(§5.1) */
app.post("/api/cards/:id/feedback", requireAuth, (req: AuthedRequest, res) => {
  const r = loadCard(req, param(req, "id"));
  if (!r.ok) {
    res.status(r.status).json({ error: r.message });
    return;
  }
  if (!r.writable) {
    res.status(403).json({ error: "这张卡对你只读" });
    return;
  }
  const { user, workspace } = req.auth!;

  const rating = Math.min(5, Math.max(1, Number(req.body?.rating ?? 3))) as Feedback["rating"];
  const feedback: Feedback = {
    rating,
    notes: String(req.body?.notes ?? "").trim(),
    why: String(req.body?.why ?? "").trim(),
    ts: Date.now(),
    authorId: user.id,
  };

  const saved = cards.update({ ...r.card, feedback }, r.card.rev);
  if (!saved) {
    res.status(409).json({ error: "这张卡已被其他人改过,先刷新" });
    return;
  }

  const scope: LibraryScope = saved.visibility === "private" ? "personal" : "team";
  const created: LibraryItem[] = [];

  // 机制写了就沉淀 —— 失败机制是规律,成功配方只是样本
  if (feedback.why) {
    created.push(
      library.insert({
        id: uid(),
        type: "failure",
        title: `${saved.name || "未命名"} — ${feedback.notes || "实践落差"}`,
        content: feedback.why,
        sourceCardId: saved.id,
        authorId: user.id,
        workspaceId: workspace.id,
        scope,
        createdAt: Date.now(),
      }),
    );
  }
  // 评分高的卡片自动入库
  if (rating >= 4 && saved.recipe) {
    created.push(
      library.insert({
        id: uid(),
        type: "recipe",
        title: `${saved.name || "未命名"}(★${rating})`,
        content: saved.recipe,
        sourceCardId: saved.id,
        authorId: user.id,
        workspaceId: workspace.id,
        scope,
        createdAt: Date.now(),
      }),
    );
  }

  res.json({ card: saved, libraryCreated: created });
});

/* ---------------- 拆解卡(§4) ---------------- */

app.post("/api/cards/:id/teardown/analyze", requireAuth, async (req: AuthedRequest, res) => {
  const r = loadCard(req, param(req, "id"));
  if (!r.ok) {
    res.status(r.status).json({ error: r.message });
    return;
  }
  if (!r.writable) {
    res.status(403).json({ error: "这张卡对你只读" });
    return;
  }
  if (r.card.type !== "teardown" || !r.card.teardown) {
    res.status(400).json({ error: "这不是一张拆解卡" });
    return;
  }
  if (!aiConfigured()) {
    res.status(503).json({ error: "服务端没有配置 ANTHROPIC_API_KEY" });
    return;
  }
  const td = r.card.teardown;
  if (!td.perception.trim() && !td.ingredients.length) {
    res.status(400).json({ error: "感受和原料至少填一栏" });
    return;
  }

  const { user, workspace } = req.auth!;
  const fw =
    frameworks.get(workspace.id, r.card.frameworkVersion) ??
    frameworks.current(workspace.id);

  const query = `${td.sourceName} ${td.perception} ${td.ingredients.join(" ")}`;
  const injection = selectInjection(
    fw,
    query,
    library.visibleTo(workspace.id, user.id),
    ingredients.visibleTo(workspace.id, user.id),
  );

  try {
    const out = await analyzeTeardown({
      fw,
      card: r.card,
      injectedLibrary: injection.items,
      ingredientHits: injection.ingredientHits,
    });

    const next: Card = {
      ...r.card,
      teardown: {
        ...td,
        gapAnalysis: out.gapAnalysis,
        placements: out.placements.map((p) => ({ id: uid(), ...p })),
        whyItWorks: out.whyItWorks,
        whyItWorksConfidence: out.whyItWorksConfidence,
        borrowable: out.borrowable,
        analyzedAt: Date.now(),
      },
    };

    const saved = cards.update(next, r.card.rev);
    if (!saved) {
      res.status(409).json({ error: "这张卡已被其他人改过,先刷新" });
      return;
    }

    const scope: LibraryScope = saved.visibility === "private" ? "personal" : "team";

    // 拆解记录回流参考库
    library.insert({
      id: uid(),
      type: "teardown",
      title: td.sourceName || saved.name || "拆解记录",
      content: [
        `为什么好喝(${out.whyItWorksConfidence === "confirmed" ? "已确认" : "推测"}):${out.whyItWorks}`,
        `可借用:${out.borrowable}`,
        `清单里有但没尝出来:${out.gapAnalysis.listedNotTasted.join("、") || "无"}`,
        `尝到了但清单里没有:${out.gapAnalysis.tastedNotListed.join("、") || "无"}`,
      ].join("\n"),
      sourceCardId: saved.id,
      authorId: user.id,
      workspaceId: workspace.id,
      scope,
      createdAt: Date.now(),
    });

    // 按原料拆成独立条目入库(§5.4)—— 不只按整杯建索引
    for (const p of out.placements) {
      if (!p.ingredient?.trim()) continue;
      ingredients.upsert({
        id: uid(),
        name: p.ingredient.trim(),
        sourceCardId: saved.id,
        functionSlots: p.functionSlots ?? [],
        step: p.step,
        rationale: p.rationale ?? "",
        confidence: p.confidence === "confirmed" ? "confirmed" : "inferred",
        authorId: user.id,
        workspaceId: workspace.id,
        scope,
        createdAt: Date.now(),
      });
    }

    res.json(saved);
  } catch (e) {
    handleAIError(e, res);
  }
});

/** 可借用的部分 → 一键开一张设计卡(§6.5) */
app.post("/api/cards/:id/spawn-design", requireAuth, requireRole("admin", "editor"), (req: AuthedRequest, res) => {
  const r = loadCard(req, param(req, "id"));
  if (!r.ok) {
    res.status(r.status).json({ error: r.message });
    return;
  }
  if (r.card.type !== "teardown" || !r.card.teardown) {
    res.status(400).json({ error: "只有拆解卡能派生设计卡" });
    return;
  }
  const { user, workspace } = req.auth!;
  const fw = frameworks.current(workspace.id);
  const td = r.card.teardown;

  const origin = [
    `从拆解「${td.sourceName || r.card.name}」借用:`,
    td.borrowable || "(未填)",
  ].join("\n");

  const card: Card = {
    id: uid(),
    type: "design",
    name: "",
    categories: [...r.card.categories],
    createdAt: Date.now(),
    updatedAt: Date.now(),
    status: "active",
    frameworkVersion: fw.version,
    origin,
    originInputMode: "text",
    ownerId: user.id,
    workspaceId: workspace.id,
    visibility: r.card.visibility,
    messages: [],
    steps: emptySteps(fw),
    pending: [],
    refs: [],
    recipe: "",
    feedback: null,
    rev: 0,
  };
  cards.insert(card);
  res.status(201).json(card);
});

/* ============================================================
   参考库与原料索引
   ============================================================ */

app.get("/api/library", requireAuth, (req: AuthedRequest, res) => {
  const { user, workspace } = req.auth!;
  res.json(
    library
      .visibleTo(workspace.id, user.id)
      .sort((a, b) => b.createdAt - a.createdAt),
  );
});

app.post("/api/library", requireAuth, requireRole("admin", "editor"), (req: AuthedRequest, res) => {
  const { user, workspace } = req.auth!;
  const fw = frameworks.current(workspace.id);
  const type = String(req.body?.type ?? "");
  if (!fw.taxonomies.libraryTypes.some((t) => t.key === type)) {
    res.status(400).json({ error: "未知的参考库类型" });
    return;
  }
  const title = String(req.body?.title ?? "").trim();
  const content = String(req.body?.content ?? "").trim();
  if (!title && !content) {
    res.status(400).json({ error: "标题和内容不能都为空" });
    return;
  }
  const item = library.insert({
    id: uid(),
    type,
    title: title || "无标题",
    content,
    sourceUrl: req.body?.sourceUrl ? String(req.body.sourceUrl) : undefined,
    authorId: user.id,
    workspaceId: workspace.id,
    scope: req.body?.scope === "personal" ? "personal" : "team",
    createdAt: Date.now(),
  });
  res.status(201).json(item);
});

app.delete("/api/library/:id", requireAuth, (req: AuthedRequest, res) => {
  const item = library.byId(param(req, "id"));
  if (!item || item.workspaceId !== req.auth!.workspace.id) {
    res.status(404).json({ error: "条目不存在" });
    return;
  }
  if (item.authorId !== req.auth!.user.id && req.auth!.role !== "admin") {
    res.status(403).json({ error: "只有作者或管理员能删除" });
    return;
  }
  library.remove(item.id);
  res.json({ ok: true });
});

app.get("/api/ingredients", requireAuth, (req: AuthedRequest, res) => {
  const { user, workspace } = req.auth!;
  const all = ingredients.visibleTo(workspace.id, user.id);
  const q = String(req.query.q ?? "").trim();
  const filtered = q ? all.filter((e) => e.name.includes(q)) : all;
  res.json(filtered.sort((a, b) => b.createdAt - a.createdAt));
});

app.delete("/api/ingredients/:id", requireAuth, (req: AuthedRequest, res) => {
  const { user, workspace } = req.auth!;
  const entry = ingredients
    .visibleTo(workspace.id, user.id)
    .find((e) => e.id === param(req, "id"));
  if (!entry) {
    res.status(404).json({ error: "条目不存在" });
    return;
  }
  if (entry.authorId !== user.id && req.auth!.role !== "admin") {
    res.status(403).json({ error: "只有作者或管理员能删除" });
    return;
  }
  ingredients.remove(entry.id);
  res.json({ ok: true });
});

/** 联网情报 —— 搜到的必须沉淀进库,不是当场用掉(§5.3) */
app.post("/api/intel", requireAuth, requireRole("admin", "editor"), async (req: AuthedRequest, res) => {
  if (!aiConfigured()) {
    res.status(503).json({ error: "服务端没有配置 ANTHROPIC_API_KEY" });
    return;
  }
  const query = String(req.body?.query ?? "").trim();
  if (!query) {
    res.status(400).json({ error: "搜什么?" });
    return;
  }
  const { user, workspace } = req.auth!;
  const fw = frameworks.current(workspace.id);

  try {
    const intel = await researchIntel({ fw, query });
    const item = library.insert({
      id: uid(),
      type: "intel",
      title: intel.title,
      content: intel.content,
      sourceUrl: intel.sources[0],
      authorId: user.id,
      workspaceId: workspace.id,
      scope: req.body?.scope === "personal" ? "personal" : "team",
      createdAt: Date.now(),
    });
    res.json({ item, sources: intel.sources });
  } catch (e) {
    handleAIError(e, res);
  }
});

/* ============================================================
   全局检索(§6.5)
   ============================================================ */

app.get("/api/search", requireAuth, (req: AuthedRequest, res) => {
  const q = String(req.query.q ?? "").trim();
  if (!q) {
    res.json({ cards: [], library: [], ingredients: [] } satisfies SearchResults);
    return;
  }
  const { user, workspace } = req.auth!;
  const fw = frameworks.current(workspace.id);
  const stepName = new Map(fw.steps.map((s) => [s.key, s.name] as const));

  const out: SearchResults = { cards: [], library: [], ingredients: [] };

  for (const c of cards.visibleTo(workspace.id, user.id)) {
    const hits: SearchResults["cards"][number]["hits"] = [];
    if (c.name.includes(q)) hits.push({ where: "名称", text: c.name });
    if (c.origin.includes(q)) hits.push({ where: "起点", text: c.origin });
    for (const [key, st] of Object.entries(c.steps)) {
      if (st.conclusion?.includes(q))
        hits.push({ where: stepName.get(key) ?? key, text: st.conclusion, step: key });
    }
    for (const p of c.pending) {
      if (p.text.includes(q)) hits.push({ where: "搁置项", text: p.text });
    }
    for (const m of c.messages) {
      if (m.content.includes(q))
        hits.push({ where: m.role === "user" ? "对话·你" : "对话·推演", text: m.content });
    }
    if (c.recipe.includes(q)) hits.push({ where: "配方", text: c.recipe });
    if (c.feedback && (c.feedback.why.includes(q) || c.feedback.notes.includes(q)))
      hits.push({ where: "实践反馈", text: c.feedback.why || c.feedback.notes });
    if (c.teardown) {
      if (c.teardown.perception.includes(q))
        hits.push({ where: "拆解·感受", text: c.teardown.perception });
      if (c.teardown.ingredients.some((i) => i.includes(q)))
        hits.push({ where: "拆解·原料", text: c.teardown.ingredients.join("、") });
      if (c.teardown.whyItWorks.includes(q))
        hits.push({ where: "为什么好喝", text: c.teardown.whyItWorks });
    }
    if (hits.length) out.cards.push({ card: c, hits: hits.slice(0, 5) });
  }

  out.library = library
    .visibleTo(workspace.id, user.id)
    .filter((l) => l.title.includes(q) || l.content.includes(q))
    .sort(
      (a, b) =>
        relScore(q, `${b.title}${b.content}`) - relScore(q, `${a.title}${a.content}`),
    );

  out.ingredients = ingredients
    .visibleTo(workspace.id, user.id)
    .filter((e) => e.name.includes(q) || e.rationale.includes(q));

  res.json(out);
});

/* ============================================================
   语音转写(§6.3)
   ============================================================ */

app.post(
  "/api/stt",
  requireAuth,
  express.raw({ type: () => true, limit: "25mb" }),
  async (req: AuthedRequest, res) => {
    if (!sttConfig()) {
      res.status(501).json({
        error: "服务端没有配置转写服务(STT_BASE_URL),请用浏览器语音或打字",
      });
      return;
    }
    const body = req.body as Buffer;
    if (!Buffer.isBuffer(body) || body.length === 0) {
      res.status(400).json({ error: "没有收到音频" });
      return;
    }
    try {
      const text = await transcribe(body, req.header("content-type") ?? "audio/webm");
      res.json({ text });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      res.status(502).json({ error: `转写失败:${msg}` });
    }
  },
);

/* ============================================================
   错误处理与静态资源
   ============================================================ */

function handleAIError(e: unknown, res: express.Response): void {
  if (e instanceof AIRefusal) {
    res.status(422).json({
      error: `模型拒绝了这次请求${e.explanation ? `:${e.explanation}` : ""}`,
    });
    return;
  }
  const msg = e instanceof Error ? e.message : String(e);
  console.error("[ai]", msg);
  res.status(502).json({ error: `这轮没接上:${msg}` });
}

const DIST = path.resolve(process.cwd(), "dist");
if (fs.existsSync(DIST)) {
  app.use(express.static(DIST));
  app.use((req, res, next) => {
    if (req.method !== "GET" || req.path.startsWith("/api/")) return next();
    res.sendFile(path.join(DIST, "index.html"));
  });
}

app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  const msg = err instanceof Error ? err.message : String(err);
  console.error("[server]", msg);
  if (!res.headersSent) res.status(500).json({ error: msg });
});

const server = app.listen(PORT, () => {
  console.log(`风味设计工作台 · 服务端 http://localhost:${PORT}`);
  if (!aiConfigured())
    console.warn("  ⚠ 未检测到 ANTHROPIC_API_KEY —— 推演相关接口会返回 503");
  if (!sttConfig())
    console.warn("  ⚠ 未配置 STT_BASE_URL —— 只有浏览器语音可用");
});

for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, () => {
    server.close(async () => {
      await flush();
      process.exit(0);
    });
  });
}
