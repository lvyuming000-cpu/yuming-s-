import type {
  AuthContext,
  Card,
  CardType,
  FrameworkConfig,
  Feedback,
  IngredientEntry,
  InputMode,
  LibraryItem,
  LibraryScope,
  ProposeConfirm,
  SearchResults,
  StepKey,
  User,
  Visibility,
  WorkspaceRole,
} from "@shared/types";

const TOKEN_KEY = "fw:token";

export const authToken = (): string | null => localStorage.getItem(TOKEN_KEY);
export const setAuthToken = (t: string | null): void => {
  if (t) localStorage.setItem(TOKEN_KEY, t);
  else localStorage.removeItem(TOKEN_KEY);
};

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public payload?: unknown,
  ) {
    super(message);
  }
  /** 409 = 别人先改了这张卡 */
  get isConflict() {
    return this.status === 409;
  }
}

async function call<T>(
  path: string,
  init: RequestInit & { json?: unknown } = {},
): Promise<T> {
  const { json, ...rest } = init;
  const headers = new Headers(rest.headers);
  const token = authToken();
  if (token) headers.set("authorization", `Bearer ${token}`);
  if (json !== undefined) headers.set("content-type", "application/json");

  const res = await fetch(path, {
    ...rest,
    headers,
    body: json !== undefined ? JSON.stringify(json) : rest.body,
  });

  if (res.status === 204) return undefined as T;

  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    throw new ApiError(
      res.status,
      typeof body.error === "string" ? body.error : `请求失败(${res.status})`,
      body,
    );
  }
  return body as T;
}

/* ---------------- 能力 ---------------- */

export interface ServerCapabilities {
  ai: boolean;
  serverStt: boolean;
}

export const getCapabilities = () => call<ServerCapabilities>("/api/config");

/* ---------------- 身份 ---------------- */

export const login = (email: string, name: string, workspaceName?: string) =>
  call<AuthContext>("/api/auth/session", {
    method: "POST",
    json: { email, name, workspaceName },
  });

export const me = () => call<AuthContext>("/api/auth/me");

export const logout = () => call<{ ok: true }>("/api/auth/logout", { method: "POST" });

export interface MemberRow {
  userId: string;
  role: WorkspaceRole;
  joinedAt: number;
  user: User | null;
}

export const getMembers = () => call<MemberRow[]>("/api/workspace/members");

export const addMember = (email: string, role: WorkspaceRole) =>
  call<{ ok: true }>("/api/workspace/members", {
    method: "POST",
    json: { email, role },
  });

/* ---------------- 框架 ---------------- */

export interface FrameworkVersionRow {
  version: string;
  label: string;
  updatedAt: number;
  updatedBy: string | null;
  stepCount: number;
}

export const getFramework = () => call<FrameworkConfig>("/api/framework");
export const getFrameworkVersions = () =>
  call<FrameworkVersionRow[]>("/api/framework/versions");
export const getFrameworkVersion = (v: string) =>
  call<FrameworkConfig>(`/api/framework/${encodeURIComponent(v)}`);
export const saveFramework = (fw: FrameworkConfig) =>
  call<FrameworkConfig>("/api/framework", { method: "PUT", json: fw });

/* ---------------- 卡片 ---------------- */

export const getCards = () => call<Card[]>("/api/cards");
export const getCard = (id: string) => call<Card>(`/api/cards/${id}`);

export const createCard = (input: {
  type: CardType;
  origin: string;
  inputMode: InputMode;
  visibility?: Visibility;
  sourceName?: string;
}) => call<Card>("/api/cards", { method: "POST", json: input });

export const patchCard = (id: string, rev: number, patch: Partial<Card>) =>
  call<Card>(`/api/cards/${id}`, { method: "PATCH", json: { rev, patch } });

export const deleteCard = (id: string) =>
  call<{ ok: true }>(`/api/cards/${id}`, { method: "DELETE" });

export interface TurnResponse {
  card: Card;
  proposeConfirm: ProposeConfirm | null;
  currentStep: StepKey | null;
  ingredientAlerts: string[];
  injectedSources: Array<{ id: string; title: string; type: string }>;
  matchedIngredients: string[];
}

export const sendTurn = (id: string, text: string, inputMode: InputMode) =>
  call<TurnResponse>(`/api/cards/${id}/turn`, {
    method: "POST",
    json: { text, inputMode },
  });

export const confirmStep = (
  id: string,
  step: StepKey,
  conclusion: string,
  unresolved: string,
) =>
  call<Card>(`/api/cards/${id}/confirm`, {
    method: "POST",
    json: { step, conclusion, unresolved },
  });

export const generateRecipe = (id: string) =>
  call<Card>(`/api/cards/${id}/recipe`, { method: "POST" });

export const saveFeedback = (
  id: string,
  fb: Pick<Feedback, "rating" | "notes" | "why">,
) =>
  call<{ card: Card; libraryCreated: LibraryItem[] }>(`/api/cards/${id}/feedback`, {
    method: "POST",
    json: fb,
  });

export const analyzeTeardown = (id: string) =>
  call<Card>(`/api/cards/${id}/teardown/analyze`, { method: "POST" });

export const spawnDesignCard = (id: string) =>
  call<Card>(`/api/cards/${id}/spawn-design`, { method: "POST" });

/* ---------------- 参考库 ---------------- */

export const getLibrary = () => call<LibraryItem[]>("/api/library");

export const addLibraryItem = (input: {
  type: string;
  title: string;
  content: string;
  scope: LibraryScope;
  sourceUrl?: string;
}) => call<LibraryItem>("/api/library", { method: "POST", json: input });

export const deleteLibraryItem = (id: string) =>
  call<{ ok: true }>(`/api/library/${id}`, { method: "DELETE" });

export const getIngredients = (q?: string) =>
  call<IngredientEntry[]>(`/api/ingredients${q ? `?q=${encodeURIComponent(q)}` : ""}`);

export const deleteIngredient = (id: string) =>
  call<{ ok: true }>(`/api/ingredients/${id}`, { method: "DELETE" });

export const researchIntel = (query: string, scope: LibraryScope) =>
  call<{ item: LibraryItem; sources: string[] }>("/api/intel", {
    method: "POST",
    json: { query, scope },
  });

/* ---------------- 检索 ---------------- */

export const search = (q: string) =>
  call<SearchResults>(`/api/search?q=${encodeURIComponent(q)}`);
