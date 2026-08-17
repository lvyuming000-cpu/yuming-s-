/* ============================================================
   风味设计工作台 · 共享数据结构
   规格来源:完整规格 v2 §2(卡片)、§4(拆解)、§5(参考库)、§6(工程)

   设计约束(不可退让):
   - StepKey 是 string,不是六个字面量。步骤数量与 key 由框架配置决定。
   - 所有卡片/库条目从一开始就带 ownerId / workspaceId / scope,
     第二阶段的团队协作不需要迁移数据结构(§5.6、§6.4)。
   ============================================================ */

export type StepKey = string;

/* ---------------- 身份与团队(§6.4) ---------------- */

export type WorkspaceRole = "admin" | "editor" | "viewer";

export interface User {
  id: string;
  email: string;
  name: string;
  createdAt: number;
}

export interface WorkspaceMember {
  userId: string;
  role: WorkspaceRole;
  joinedAt: number;
}

export interface Workspace {
  id: string;
  name: string;
  ownerId: string;
  members: WorkspaceMember[];
  /** 当前生效的框架版本号(团队级共享,§6.2) */
  frameworkVersion: string;
  createdAt: number;
}

/** 登录后前端持有的会话上下文 */
export interface AuthContext {
  user: User;
  workspace: Workspace;
  role: WorkspaceRole;
  token: string;
}

/* ---------------- 框架配置(§1 + §6.1) ---------------- */

/**
 * 一个步骤的完整定义。规格 §6.1 要求每步至少包含:
 * key / 序号 / 名称 / 引导语 / AI 在该步的职责描述 / 该步的校验规则。
 */
export interface StepDef {
  key: StepKey;
  order: number;
  name: string;
  /** 引导语 — 空槽时显示给用户 */
  hint: string;
  /** AI 在这一步的职责(拼进系统提示的「按步位切换角色」) */
  aiRole: string;
  /** 该步的校验规则,有序。结构三角的五步校验顺序就落在这里(§3.3) */
  checks: string[];
  /** 该步收尾必须达成的条件,没有就留空 */
  exitCriterion?: string;
}

/** §1.3 / §1.4 / §1.5 / §1.6 这类「知识段落」,全部是可编辑文本 */
export interface KnowledgeSection {
  id: string;
  title: string;
  /** 正文,markdown 风格纯文本,原样拼进系统提示 */
  body: string;
  /** 排序 */
  order: number;
}

export interface CategoryDef {
  key: string;
  label: string;
  /** 十六进制色,用于卡片强调色 */
  color: string;
}

export interface LibraryTypeDef {
  key: string;
  label: string;
  color: string;
  /** 调用策略说明,显示在 UI 上 */
  note: string;
  /**
   * always = 每轮全量注入(失败记录)
   * relevance = 按相关度取前 N
   * ingredient = 按原料名精确命中(§5.4/§5.5)
   */
  retrieval: "always" | "relevance" | "ingredient";
}

export interface BehaviorConfig {
  /** 每轮回应必须覆盖的三件事(§3.1) */
  turnContract: string[];
  /** 发散边界(§3.4) */
  divergence: string[];
  /** 起步处理(§3.2) */
  startup: string[];
  /** 封步话术模板(§3.5) */
  sealingTemplate: string;
  /** 语气(§3.6) */
  tone: string;
  /** 明令禁止的收尾方式 */
  forbidden: string[];
}

export interface RetrievalConfig {
  /** 相关度取前 N 条(§5.2) */
  relevanceTopK: number;
  /** 2-gram 重合计数阈值,低于此值不算命中 */
  minRelevanceScore: number;
  /** 单次注入的条目内容截断长度,防止上下文膨胀 */
  maxItemChars: number;
}

export interface TeardownConfig {
  /** 三类落差的展示文案(§4.2) */
  gapLabels: {
    tastedAndListed: string;
    listedNotTasted: string;
    tastedNotListed: string;
  };
  /** confirmed / inferred 的说明(§4.4) */
  confidenceNote: string;
}

export interface FrameworkConfig {
  /** 单调递增的版本号,每次保存 +1(§6.2) */
  version: string;
  /** 人可读的版本说明 */
  label: string;
  workspaceId: string;
  updatedAt: number;
  updatedBy: string | null;

  /** 引擎身份与任务声明 — 系统提示的开场 */
  identity: {
    title: string;
    mission: string;
  };
  /** §1.1 六步流程的整体逻辑说明 */
  flowPrinciple: string;
  steps: StepDef[];
  /** §1.2–§1.6 全部作为可编辑知识段落 */
  sections: KnowledgeSection[];
  behavior: BehaviorConfig;
  taxonomies: {
    categories: CategoryDef[];
    libraryTypes: LibraryTypeDef[];
    /** §1.4 香气功能角色 + §1.6 一物多用要用到的功能位词表 */
    functionSlots: string[];
  };
  retrieval: RetrievalConfig;
  teardown: TeardownConfig;
}

/* ---------------- 卡片(§2.1) ---------------- */

export type CardType = "design" | "teardown";
export type CardStatus = "active" | "done" | "shelved";
export type Visibility = "private" | "team_read" | "team_edit";
export type InputMode = "voice" | "text";
export type Confidence = "confirmed" | "inferred";

export interface StepState {
  state: "empty" | "discussing" | "confirmed";
  conclusion: string;
  confirmedAt?: number;
  confirmedBy?: string;
}

export interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  ts: number;
  authorId?: string;
  inputMode?: InputMode;
  /** 本轮引用到的参考库条目 id */
  sources?: string[];
  /** 本轮触发的原料级主动提示(§5.5) */
  ingredientAlerts?: string[];
}

export interface PendingItem {
  id: string;
  text: string;
  fromStep: StepKey;
  createdAt: number;
  resolved: boolean;
}

export interface Feedback {
  rating: 1 | 2 | 3 | 4 | 5;
  /** 哪里不行 */
  notes: string;
  /** 机制 —— 这一栏比评分重要(§2.2) */
  why: string;
  ts: number;
  authorId?: string;
}

/* ---------------- 拆解卡(§4.2) ---------------- */

export interface GapAnalysis {
  tastedAndListed: string[];
  listedNotTasted: string[];
  tastedNotListed: string[];
}

/** 六步归位的一项,每项独立标注 confirmed / inferred(§4.4) */
export interface Placement {
  id: string;
  ingredient: string;
  step: StepKey;
  functionSlots: string[];
  rationale: string;
  confidence: Confidence;
}

export interface TeardownData {
  /** 这杯东西叫什么、在哪喝的 */
  sourceName: string;
  /** 【感受】用户主观描述,语音输入为主 —— 与原料分开存储,不可合并 */
  perception: string;
  perceptionInputMode?: InputMode;
  /** 【原料】店家提供的客观清单 */
  ingredients: string[];
  gapAnalysis: GapAnalysis | null;
  placements: Placement[];
  whyItWorks: string;
  whyItWorksConfidence: Confidence;
  borrowable: string;
  analyzedAt?: number;
}

export interface Card {
  id: string;
  type: CardType;
  name: string;
  categories: string[];
  createdAt: number;
  updatedAt: number;
  status: CardStatus;
  /** 推演时所用的框架版本(§6.2) */
  frameworkVersion: string;

  /** 最初那句话,语音转文字原文,不修饰(§2.2) */
  origin: string;
  originInputMode?: InputMode;

  ownerId: string;
  workspaceId: string;
  visibility: Visibility;

  messages: Message[];
  steps: Record<StepKey, StepState>;
  pending: PendingItem[];
  /** 引用到的参考库条目 id */
  refs: string[];
  recipe: string;
  feedback: Feedback | null;

  teardown?: TeardownData;

  /** 乐观并发:每次写入 +1,多人接力时用它挡住过期写(§6.4) */
  rev: number;
}

/* ---------------- 参考库(§5.1 / §5.4) ---------------- */

export type LibraryScope = "personal" | "team";

export interface LibraryItem {
  id: string;
  type: string;
  title: string;
  content: string;
  sourceCardId?: string;
  sourceUrl?: string;
  authorId: string;
  workspaceId: string;
  scope: LibraryScope;
  createdAt: number;
}

/** §5.4 原料级索引 —— 让库从「案例集」变成「原料知识库」 */
export interface IngredientEntry {
  id: string;
  name: string;
  sourceCardId: string;
  functionSlots: string[];
  step: StepKey;
  rationale: string;
  confidence: Confidence;
  authorId: string;
  workspaceId: string;
  scope: LibraryScope;
  createdAt: number;
}

/* ---------------- AI 结构化输出(§3.7) ---------------- */

export interface ProposeConfirm {
  step: StepKey;
  conclusion: string;
  unresolved: string;
}

export interface TurnResult {
  reply: string;
  currentStep: StepKey | null;
  discussing: StepKey[];
  proposeConfirm: ProposeConfirm | null;
  newPending: string[];
  sourcesUsed: string[];
  ingredientAlerts: string[];
  suggestName: string;
  suggestCategories: string[];
  /** 本轮析出的原料条目,回流进原料索引(§5.4) */
  ingredientsExtracted: Array<{
    name: string;
    step: StepKey;
    functionSlots: string[];
    rationale: string;
    confidence: Confidence;
  }>;
}

export interface TeardownResult {
  gapAnalysis: GapAnalysis;
  placements: Array<{
    ingredient: string;
    step: StepKey;
    functionSlots: string[];
    rationale: string;
    confidence: Confidence;
  }>;
  whyItWorks: string;
  whyItWorksConfidence: Confidence;
  borrowable: string;
}

/* ---------------- 检索结果 ---------------- */

export interface SearchHit {
  where: string;
  text: string;
  step?: StepKey;
}

export interface SearchResults {
  cards: Array<{ card: Card; hits: SearchHit[] }>;
  library: LibraryItem[];
  ingredients: IngredientEntry[];
}
