import type { Card, FrameworkConfig, StepKey, StepState } from "./types.js";

export const uid = (): string =>
  Date.now().toString(36) + Math.random().toString(36).slice(2, 9);

export function sortedSteps(fw: FrameworkConfig) {
  return [...fw.steps].sort((a, b) => a.order - b.order);
}

export function stepKeys(fw: FrameworkConfig): StepKey[] {
  return sortedSteps(fw).map((s) => s.key);
}

export function stepDef(fw: FrameworkConfig, key: StepKey) {
  return fw.steps.find((s) => s.key === key) ?? null;
}

export function emptySteps(fw: FrameworkConfig): Record<StepKey, StepState> {
  const out: Record<StepKey, StepState> = {};
  for (const s of fw.steps) out[s.key] = { state: "empty", conclusion: "" };
  return out;
}

/**
 * 卡片可能是旧框架版本建的。渲染时按当前框架的步骤列表对齐:
 * 当前框架有、卡片没有的槽补空;卡片有、当前框架没有的槽保留在末尾
 * 并标记为「已移除的步骤」,不静默丢掉用户的结论(§6.2)。
 */
export function alignSteps(
  card: Card,
  fw: FrameworkConfig,
): Array<{ key: StepKey; state: StepState; orphaned: boolean }> {
  const known = new Set(fw.steps.map((s) => s.key));
  const aligned = sortedSteps(fw).map((s) => ({
    key: s.key,
    state: card.steps[s.key] ?? { state: "empty" as const, conclusion: "" },
    orphaned: false,
  }));
  const orphans = Object.keys(card.steps)
    .filter((k) => !known.has(k))
    .map((k) => ({ key: k, state: card.steps[k], orphaned: true }));
  return [...aligned, ...orphans];
}

export function litCount(card: Card, fw: FrameworkConfig): number {
  return fw.steps.filter((s) => card.steps[s.key]?.state === "confirmed").length;
}

export function allLit(card: Card, fw: FrameworkConfig): boolean {
  return fw.steps.length > 0 && litCount(card, fw) === fw.steps.length;
}

export function accentColor(card: Card, fw: FrameworkConfig): string {
  for (const c of fw.taxonomies.categories) {
    if (card.categories.includes(c.key)) return c.color;
  }
  return fw.taxonomies.categories[0]?.color ?? "#C9D94F";
}

export function fmtDate(ts: number): string {
  const d = new Date(ts);
  return `${d.getMonth() + 1}.${d.getDate()}`;
}

export function canEdit(
  card: Card,
  userId: string,
  role: "admin" | "editor" | "viewer",
): boolean {
  if (card.ownerId === userId) return true;
  if (card.visibility === "team_edit") return role === "admin" || role === "editor";
  return false;
}

export function canRead(card: Card, userId: string): boolean {
  return card.ownerId === userId || card.visibility !== "private";
}
