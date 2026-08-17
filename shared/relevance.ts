/* ============================================================
   中文友好的粗糙相关度:2-gram 重合计数(§5.2 的基线实现)
   规格说明:若接向量检索则换成 embedding 相似度,阈值需实测调整。
   这里把它做成纯函数,替换时只动这一个文件。
   ============================================================ */

export function grams(s: string): Set<string> {
  const t = (s || "").replace(/\s+/g, "");
  const out = new Set<string>();
  for (let i = 0; i < t.length - 1; i++) out.add(t.slice(i, i + 2));
  return out;
}

export function relScore(query: string, text: string): number {
  const a = grams(query);
  const b = grams(text);
  let n = 0;
  for (const g of a) if (b.has(g)) n++;
  return n;
}

/**
 * 从一段文本里找出提到的原料名(§5.5 主动提示的触发)。
 * 精确子串匹配 —— 原料名是名词,不需要模糊。按长度降序,
 * 避免「抹茶」把「抹茶粉」的命中吃掉。
 */
export function matchIngredientNames(text: string, names: string[]): string[] {
  const t = (text || "").replace(/\s+/g, "");
  const sorted = [...new Set(names)].sort((a, b) => b.length - a.length);
  const hit: string[] = [];
  for (const name of sorted) {
    const n = name.replace(/\s+/g, "");
    if (!n) continue;
    if (t.includes(n) && !hit.some((h) => h.includes(n))) hit.push(name);
  }
  return hit;
}
