import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { DEFAULT_FRAMEWORK } from "../shared/framework/defaultFramework.js";
import type {
  Card,
  FrameworkConfig,
  IngredientEntry,
  LibraryItem,
  User,
  Workspace,
} from "../shared/types.js";
import { uid } from "../shared/util.js";

/* ============================================================
   存储层
   ------------------------------------------------------------
   单文件 JSON + 原子写。刻意做成一个窄接口:所有读写都过这里,
   将来换 Postgres 只需要换这个文件的实现,路由层不动。

   框架配置按版本号存全量快照(frameworks: Record<version, config>),
   卡片记录自己用的 frameworkVersion —— 三个月后改了定义,
   回看旧卡片仍能知道它当初是按哪套规则推演的(§6.2)。
   ============================================================ */

const DATA_DIR = process.env.DATA_DIR ?? path.resolve(process.cwd(), "data");
const DB_FILE = path.join(DATA_DIR, "db.json");

export interface Session {
  token: string;
  userId: string;
  workspaceId: string;
  createdAt: number;
}

interface DB {
  users: User[];
  workspaces: Workspace[];
  sessions: Session[];
  cards: Card[];
  library: LibraryItem[];
  ingredients: IngredientEntry[];
  /** workspaceId -> version -> 全量框架快照 */
  frameworks: Record<string, Record<string, FrameworkConfig>>;
}

const EMPTY_DB: DB = {
  users: [],
  workspaces: [],
  sessions: [],
  cards: [],
  library: [],
  ingredients: [],
  frameworks: {},
};

let db: DB = structuredClone(EMPTY_DB);
let writeTimer: NodeJS.Timeout | null = null;
let writing: Promise<void> = Promise.resolve();

export function loadSync(): void {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(DB_FILE)) {
    db = structuredClone(EMPTY_DB);
    flushSync();
    return;
  }
  try {
    const raw = fs.readFileSync(DB_FILE, "utf8");
    db = { ...structuredClone(EMPTY_DB), ...JSON.parse(raw) };
  } catch (e) {
    // 不静默吞掉:损坏的库先备份再从空库起步,免得用户数据被覆盖。
    const backup = `${DB_FILE}.corrupt.${Date.now()}`;
    fs.copyFileSync(DB_FILE, backup);
    console.error(`[store] db.json 解析失败,已备份到 ${backup},从空库启动`, e);
    db = structuredClone(EMPTY_DB);
  }
}

function flushSync(): void {
  const tmp = `${DB_FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2));
  fs.renameSync(tmp, DB_FILE);
}

/** 防抖持久化 —— 输入停顿后触发,跨会话保留(§6.6) */
function persist(): void {
  if (writeTimer) clearTimeout(writeTimer);
  writeTimer = setTimeout(() => {
    writing = writing.then(async () => {
      const tmp = `${DB_FILE}.tmp`;
      await fsp.writeFile(tmp, JSON.stringify(db, null, 2));
      await fsp.rename(tmp, DB_FILE);
    });
  }, 250);
}

export async function flush(): Promise<void> {
  if (writeTimer) {
    clearTimeout(writeTimer);
    writeTimer = null;
  }
  const tmp = `${DB_FILE}.tmp`;
  await fsp.writeFile(tmp, JSON.stringify(db, null, 2));
  await fsp.rename(tmp, DB_FILE);
  await writing;
}

/* ---------------- 用户与团队 ---------------- */

export const users = {
  byEmail: (email: string) =>
    db.users.find((u) => u.email.toLowerCase() === email.toLowerCase()) ?? null,
  byId: (id: string) => db.users.find((u) => u.id === id) ?? null,
  create(email: string, name: string): User {
    const user: User = { id: uid(), email, name, createdAt: Date.now() };
    db.users.push(user);
    persist();
    return user;
  },
  list: () => [...db.users],
};

export const workspaces = {
  byId: (id: string) => db.workspaces.find((w) => w.id === id) ?? null,
  forUser: (userId: string) =>
    db.workspaces.filter((w) => w.members.some((m) => m.userId === userId)),
  create(name: string, ownerId: string): Workspace {
    const ws: Workspace = {
      id: uid(),
      name,
      ownerId,
      members: [{ userId: ownerId, role: "admin", joinedAt: Date.now() }],
      frameworkVersion: "1",
      createdAt: Date.now(),
    };
    db.workspaces.push(ws);
    // 新团队自带一份默认框架快照
    db.frameworks[ws.id] = {
      "1": {
        ...structuredClone(DEFAULT_FRAMEWORK),
        version: "1",
        workspaceId: ws.id,
        updatedAt: Date.now(),
        updatedBy: ownerId,
      },
    };
    persist();
    return ws;
  },
  update(ws: Workspace): Workspace {
    const i = db.workspaces.findIndex((w) => w.id === ws.id);
    if (i >= 0) db.workspaces[i] = ws;
    persist();
    return ws;
  },
  addMember(workspaceId: string, userId: string, role: "admin" | "editor" | "viewer") {
    const ws = workspaces.byId(workspaceId);
    if (!ws) return null;
    if (!ws.members.some((m) => m.userId === userId)) {
      ws.members.push({ userId, role, joinedAt: Date.now() });
      persist();
    }
    return ws;
  },
  roleOf(workspaceId: string, userId: string) {
    const ws = workspaces.byId(workspaceId);
    return ws?.members.find((m) => m.userId === userId)?.role ?? null;
  },
};

export const sessions = {
  create(userId: string, workspaceId: string): Session {
    const s: Session = {
      token: uid() + uid(),
      userId,
      workspaceId,
      createdAt: Date.now(),
    };
    db.sessions.push(s);
    persist();
    return s;
  },
  byToken: (token: string) => db.sessions.find((s) => s.token === token) ?? null,
  revoke(token: string) {
    db.sessions = db.sessions.filter((s) => s.token !== token);
    persist();
  },
};

/* ---------------- 框架配置(§6.1 / §6.2) ---------------- */

export const frameworks = {
  get(workspaceId: string, version: string): FrameworkConfig | null {
    return db.frameworks[workspaceId]?.[version] ?? null;
  },
  current(workspaceId: string): FrameworkConfig {
    const ws = workspaces.byId(workspaceId);
    if (!ws) throw new Error(`unknown workspace ${workspaceId}`);
    const fw = frameworks.get(workspaceId, ws.frameworkVersion);
    if (fw) return fw;
    // 自愈:指针指向了不存在的版本时重建版本 1
    return frameworks.save(
      workspaceId,
      { ...structuredClone(DEFAULT_FRAMEWORK) } as FrameworkConfig,
      null,
    );
  },
  versions(workspaceId: string): FrameworkConfig[] {
    const all = db.frameworks[workspaceId] ?? {};
    return Object.values(all).sort((a, b) => Number(b.version) - Number(a.version));
  },
  /** 每次保存产生一个新版本号,并把团队指针指过去 */
  save(
    workspaceId: string,
    next: Omit<FrameworkConfig, "version" | "workspaceId" | "updatedAt" | "updatedBy">,
    updatedBy: string | null,
  ): FrameworkConfig {
    const bucket = (db.frameworks[workspaceId] ??= {});
    const maxVersion = Object.keys(bucket).reduce((m, v) => Math.max(m, Number(v)), 0);
    const version = String(maxVersion + 1);
    const saved: FrameworkConfig = {
      ...structuredClone(next),
      version,
      workspaceId,
      updatedAt: Date.now(),
      updatedBy,
    };
    bucket[version] = saved;
    const ws = workspaces.byId(workspaceId);
    if (ws) {
      ws.frameworkVersion = version;
      workspaces.update(ws);
    }
    persist();
    return saved;
  },
};

/* ---------------- 卡片 ---------------- */

export const cards = {
  byId: (id: string) => db.cards.find((c) => c.id === id) ?? null,
  /** 团队内可见的卡片:自己的 + 团队可见的 */
  visibleTo(workspaceId: string, userId: string): Card[] {
    return db.cards.filter(
      (c) =>
        c.workspaceId === workspaceId &&
        (c.ownerId === userId || c.visibility !== "private"),
    );
  },
  insert(card: Card): Card {
    db.cards.push(card);
    persist();
    return card;
  },
  /**
   * 乐观并发写:expectedRev 与当前不符时返回 null,由路由层回 409。
   * 多人接力同一张卡时,后写的人会拿到冲突而不是静默覆盖(§6.4)。
   */
  update(next: Card, expectedRev: number): Card | null {
    const i = db.cards.findIndex((c) => c.id === next.id);
    if (i < 0) return null;
    if (db.cards[i].rev !== expectedRev) return null;
    const saved: Card = { ...next, rev: db.cards[i].rev + 1, updatedAt: Date.now() };
    db.cards[i] = saved;
    persist();
    return saved;
  },
  remove(id: string) {
    db.cards = db.cards.filter((c) => c.id !== id);
    persist();
  },
};

/* ---------------- 参考库与原料索引 ---------------- */

export const library = {
  visibleTo(workspaceId: string, userId: string): LibraryItem[] {
    return db.library.filter(
      (l) =>
        l.workspaceId === workspaceId && (l.scope === "team" || l.authorId === userId),
    );
  },
  byId: (id: string) => db.library.find((l) => l.id === id) ?? null,
  insert(item: LibraryItem): LibraryItem {
    db.library.push(item);
    persist();
    return item;
  },
  remove(id: string) {
    db.library = db.library.filter((l) => l.id !== id);
    persist();
  },
};

export const ingredients = {
  visibleTo(workspaceId: string, userId: string): IngredientEntry[] {
    return db.ingredients.filter(
      (e) =>
        e.workspaceId === workspaceId && (e.scope === "team" || e.authorId === userId),
    );
  },
  insert(entry: IngredientEntry): IngredientEntry {
    db.ingredients.push(entry);
    persist();
    return entry;
  },
  /** 同一张卡对同一原料重复析出时覆盖,避免库里堆同义条目 */
  upsert(entry: IngredientEntry): IngredientEntry {
    const i = db.ingredients.findIndex(
      (e) => e.sourceCardId === entry.sourceCardId && e.name === entry.name,
    );
    if (i >= 0) {
      db.ingredients[i] = { ...entry, id: db.ingredients[i].id };
      persist();
      return db.ingredients[i];
    }
    return ingredients.insert(entry);
  },
  removeByCard(cardId: string) {
    db.ingredients = db.ingredients.filter((e) => e.sourceCardId !== cardId);
    persist();
  },
  remove(id: string) {
    db.ingredients = db.ingredients.filter((e) => e.id !== id);
    persist();
  },
};

/** 仅供测试用:重置内存态 */
export function __resetForTest(): void {
  db = structuredClone(EMPTY_DB);
}
