import { matchIngredientNames, relScore } from "../shared/relevance.js";
import type {
  FrameworkConfig,
  IngredientEntry,
  LibraryItem,
} from "../shared/types.js";

/* ============================================================
   检索规则(§5.2 / §5.4 / §5.5)
   - retrieval: "always"     → 全量注入(失败记录)
   - retrieval: "relevance"  → 2-gram 相关度取前 N
   - retrieval: "ingredient" → 按原料名精确命中
   哪种类型走哪条路由由框架配置决定,不在这里写死类型名。
   ============================================================ */

export interface Injection {
  items: LibraryItem[];
  ingredientHits: IngredientEntry[];
  /** 命中的原料名,用于前端提示与埋点 */
  matchedIngredientNames: string[];
}

export function selectInjection(
  fw: FrameworkConfig,
  query: string,
  library: LibraryItem[],
  ingredients: IngredientEntry[],
): Injection {
  const strategyOf = new Map(
    fw.taxonomies.libraryTypes.map((t) => [t.key, t.retrieval] as const),
  );

  // 1) 全量注入的类型 —— 漏掉代价最大,不做过滤
  const always = library.filter((l) => strategyOf.get(l.type) === "always");

  // 2) 其余按相关度,取前 N
  const scored = library
    .filter((l) => (strategyOf.get(l.type) ?? "relevance") === "relevance")
    .map((l) => ({ item: l, score: relScore(query, `${l.title}${l.content}`) }))
    .filter((x) => x.score >= fw.retrieval.minRelevanceScore)
    .sort((a, b) => b.score - a.score)
    .slice(0, fw.retrieval.relevanceTopK)
    .map((x) => x.item);

  // 3) 原料级索引:按名字精确命中,命中则注入该原料的全部历史条目
  const names = [...new Set(ingredients.map((e) => e.name))];
  const matched = matchIngredientNames(query, names);
  const ingredientHits = matched.length
    ? ingredients.filter((e) => matched.includes(e.name))
    : [];

  return {
    items: [...always, ...scored],
    ingredientHits,
    matchedIngredientNames: matched,
  };
}
