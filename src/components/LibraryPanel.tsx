import { useMemo, useState } from "react";
import type {
  AuthContext,
  FrameworkConfig,
  IngredientEntry,
  LibraryItem,
  LibraryScope,
} from "@shared/types";
import { stepDef } from "@shared/util";
import * as api from "../api";
import { C, inputStyle, mono } from "../theme";
import { Btn, ConfidenceTag, ErrorBar, Mono, SectionLabel } from "./primitives";

/* ============================================================
   参考库(§5)
   ------------------------------------------------------------
   类型列表来自框架配置,不是写死的四个。
   每种类型的调用策略(每轮必检 / 按相关度 / 按原料名)也由配置决定,
   这里只负责显示它写的 note。

   原料索引单独一栏 —— 这一条让库从「案例集」变成「原料知识库」。
   ============================================================ */

export function LibraryPanel({
  fw,
  auth,
  library,
  ingredients,
  aiEnabled,
  onChanged,
}: {
  fw: FrameworkConfig;
  auth: AuthContext;
  library: LibraryItem[];
  ingredients: IngredientEntry[];
  aiEnabled: boolean;
  onChanged: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<"items" | "ingredients">("items");
  const [type, setType] = useState(fw.taxonomies.libraryTypes[0]?.key ?? "");
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [scope, setScope] = useState<LibraryScope>("team");
  const [intelQuery, setIntelQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const canWrite = auth.role === "admin" || auth.role === "editor";

  const byType = useMemo(
    () =>
      fw.taxonomies.libraryTypes.map((t) => ({
        ...t,
        items: library.filter((l) => l.type === t.key),
      })),
    [fw, library],
  );

  const submit = async () => {
    if (!title.trim() && !content.trim()) return;
    setBusy(true);
    setErr("");
    try {
      await api.addLibraryItem({
        type,
        title: title.trim(),
        content: content.trim(),
        scope,
      });
      setTitle("");
      setContent("");
      onChanged();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "存入失败");
    } finally {
      setBusy(false);
    }
  };

  const runIntel = async () => {
    if (!intelQuery.trim()) return;
    setBusy(true);
    setErr("");
    try {
      await api.researchIntel(intelQuery.trim(), scope);
      setIntelQuery("");
      onChanged();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "搜索失败");
    } finally {
      setBusy(false);
    }
  };

  const currentType = fw.taxonomies.libraryTypes.find((t) => t.key === type);

  return (
    <div style={{ borderTop: `1px solid ${C.edgeSoft}`, paddingTop: 20, marginTop: 34 }}>
      <div
        onClick={() => setOpen(!open)}
        style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer" }}
      >
        <Mono style={{ fontSize: 10.5, color: C.muted, letterSpacing: "0.14em" }}>
          参考库 / REFERENCE
        </Mono>
        <div style={{ flex: 1, height: 1, background: C.edgeSoft }} />
        <Mono style={{ fontSize: 10.5, color: C.dim }}>
          {library.length} 条 · {ingredients.length} 原料
        </Mono>
        <span style={{ color: C.dim, fontSize: 11 }}>{open ? "−" : "+"}</span>
      </div>

      {open && (
        <div style={{ marginTop: 16 }}>
          <div style={{ fontSize: 11, color: C.dim, lineHeight: 1.7, marginBottom: 14 }}>
            {fw.taxonomies.libraryTypes
              .map((t) => `${t.label}:${t.note}`)
              .join(" · ")}
            {" · 引用时会标明来源"}
          </div>

          <div style={{ display: "flex", gap: 6, marginBottom: 16 }}>
            {(["items", "ingredients"] as const).map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                style={{
                  background: tab === t ? C.raised : "transparent",
                  border: `1px solid ${tab === t ? C.edge : C.edgeSoft}`,
                  color: tab === t ? C.bone : C.dim,
                  borderRadius: 2,
                  padding: "5px 12px",
                  fontSize: 11.5,
                  fontFamily: mono,
                  cursor: "pointer",
                }}
              >
                {t === "items" ? "条目" : `原料索引 (${ingredients.length})`}
              </button>
            ))}
          </div>

          {err && (
            <div style={{ marginBottom: 12 }}>
              <ErrorBar text={err} onClose={() => setErr("")} />
            </div>
          )}

          {tab === "items" ? (
            <>
              {canWrite && (
                <div style={{ marginBottom: 22 }}>
                  <div
                    style={{ display: "flex", gap: 6, marginBottom: 10, flexWrap: "wrap" }}
                  >
                    {fw.taxonomies.libraryTypes.map((t) => (
                      <button
                        key={t.key}
                        onClick={() => setType(t.key)}
                        style={{
                          background:
                            type === t.key ? "rgba(255,255,255,.05)" : "transparent",
                          border: `1px solid ${type === t.key ? t.color : C.edgeSoft}`,
                          color: type === t.key ? t.color : C.dim,
                          borderRadius: 2,
                          padding: "5px 10px",
                          fontSize: 11.5,
                          cursor: "pointer",
                        }}
                      >
                        {t.label}
                      </button>
                    ))}
                  </div>

                  <input
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder="标题 — 如「松露低温出不来香」"
                    style={inputStyle}
                  />
                  <textarea
                    value={content}
                    onChange={(e) => setContent(e.target.value)}
                    placeholder={
                      currentType?.retrieval === "always"
                        ? "为什么不行?写机制,不只写结论 — 这部分最值钱"
                        : "内容"
                    }
                    rows={3}
                    style={{
                      ...inputStyle,
                      marginTop: 7,
                      resize: "vertical",
                      lineHeight: 1.7,
                    }}
                  />
                  <div
                    style={{
                      marginTop: 8,
                      display: "flex",
                      gap: 8,
                      alignItems: "center",
                      flexWrap: "wrap",
                    }}
                  >
                    <Btn onClick={() => void submit()} disabled={busy}>
                      存入参考库
                    </Btn>
                    <select
                      value={scope}
                      onChange={(e) => setScope(e.target.value as LibraryScope)}
                      style={{
                        ...inputStyle,
                        width: "auto",
                        padding: "5px 8px",
                        fontSize: 11,
                        fontFamily: mono,
                      }}
                    >
                      <option value="team">团队共享</option>
                      <option value="personal">仅自己</option>
                    </select>
                  </div>

                  {/* 联网情报 —— 搜到的沉淀进库,不是当场用掉(§5.3) */}
                  {aiEnabled && (
                    <div
                      style={{
                        marginTop: 16,
                        paddingTop: 14,
                        borderTop: `1px solid ${C.edgeSoft}`,
                      }}
                    >
                      <SectionLabel>联网调研 → 沉淀成情报</SectionLabel>
                      <div
                        style={{
                          fontSize: 11,
                          color: C.dim,
                          lineHeight: 1.7,
                          margin: "6px 0 9px",
                        }}
                      >
                        搜到的东西会存进库,下次讨论自动被调用。只转述公开信息,不逐字引用原文。
                      </div>
                      <div style={{ display: "flex", gap: 8 }}>
                        <input
                          value={intelQuery}
                          onChange={(e) => setIntelQuery(e.target.value)}
                          onKeyDown={(e) => e.key === "Enter" && void runIntel()}
                          placeholder="如「全球抹茶饮品现状」"
                          style={inputStyle}
                        />
                        <Btn
                          onClick={() => void runIntel()}
                          disabled={busy || !intelQuery.trim()}
                        >
                          {busy ? "搜索中…" : "搜索"}
                        </Btn>
                      </div>
                    </div>
                  )}
                </div>
              )}

              <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                {byType.map(
                  (t) =>
                    t.items.length > 0 && (
                      <div key={t.key}>
                        <Mono
                          style={{ fontSize: 10, color: t.color, letterSpacing: "0.1em" }}
                        >
                          {t.label} · {t.note}
                        </Mono>
                        <div
                          style={{
                            marginTop: 7,
                            display: "flex",
                            flexDirection: "column",
                            gap: 5,
                          }}
                        >
                          {t.items.map((it) => (
                            <div
                              key={it.id}
                              style={{
                                background: C.surface,
                                border: `1px solid ${C.edgeSoft}`,
                                borderLeft: `2px solid ${t.color}`,
                                borderRadius: 2,
                                padding: "9px 11px",
                                display: "flex",
                                gap: 10,
                              }}
                            >
                              <div style={{ flex: 1, minWidth: 0 }}>
                                <div
                                  style={{
                                    fontSize: 12.5,
                                    color: C.bone,
                                    display: "flex",
                                    gap: 8,
                                    alignItems: "baseline",
                                    flexWrap: "wrap",
                                  }}
                                >
                                  {it.title}
                                  {it.scope === "personal" && (
                                    <Mono style={{ fontSize: 9, color: C.dim }}>
                                      仅自己
                                    </Mono>
                                  )}
                                  {it.sourceCardId && (
                                    <Mono style={{ fontSize: 9, color: C.skeleton }}>
                                      自动回流
                                    </Mono>
                                  )}
                                </div>
                                {it.content && (
                                  <div
                                    style={{
                                      fontSize: 11.5,
                                      color: C.muted,
                                      marginTop: 4,
                                      lineHeight: 1.65,
                                      whiteSpace: "pre-wrap",
                                    }}
                                  >
                                    {it.content}
                                  </div>
                                )}
                                {it.sourceUrl && (
                                  <a
                                    href={it.sourceUrl}
                                    target="_blank"
                                    rel="noreferrer"
                                    style={{
                                      fontSize: 10.5,
                                      color: C.skeleton,
                                      fontFamily: mono,
                                      marginTop: 5,
                                      display: "inline-block",
                                    }}
                                  >
                                    来源链接 ↗
                                  </a>
                                )}
                              </div>
                              {(it.authorId === auth.user.id || auth.role === "admin") && (
                                <button
                                  onClick={async () => {
                                    await api.deleteLibraryItem(it.id);
                                    onChanged();
                                  }}
                                  style={{
                                    background: "none",
                                    border: "none",
                                    color: C.dim,
                                    cursor: "pointer",
                                    fontSize: 13,
                                    flexShrink: 0,
                                    alignSelf: "flex-start",
                                  }}
                                >
                                  ×
                                </button>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    ),
                )}
                {!library.length && (
                  <Mono style={{ fontSize: 11.5, color: C.dim }}>
                    库还是空的。实践反馈里写了机制会自动回流成失败记录。
                  </Mono>
                )}
              </div>
            </>
          ) : (
            <IngredientIndex
              entries={ingredients}
              fw={fw}
              auth={auth}
              onChanged={onChanged}
            />
          )}
        </div>
      )}
    </div>
  );
}

function IngredientIndex({
  entries,
  fw,
  auth,
  onChanged,
}: {
  entries: IngredientEntry[];
  fw: FrameworkConfig;
  auth: AuthContext;
  onChanged: () => void;
}) {
  const grouped = useMemo(() => {
    const map = new Map<string, IngredientEntry[]>();
    for (const e of entries) {
      const list = map.get(e.name) ?? [];
      list.push(e);
      map.set(e.name, list);
    }
    return [...map.entries()].sort((a, b) => b[1].length - a[1].length);
  }, [entries]);

  if (!entries.length) {
    return (
      <Mono style={{ fontSize: 11.5, color: C.dim, lineHeight: 1.8 }}>
        还没有原料条目。设计和拆解过程中谈定的原料会自动按名字析出到这里 ——
        下次提到同一个原料,历史用法会被自动调出来。
      </Mono>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ fontSize: 11, color: C.dim, lineHeight: 1.7 }}>
        按原料建索引,不是按整杯。提到某个原料时它的全部历史用法会被调出来;
        如果这次的功能位和以前不同,推演会主动指出差异。
      </div>
      {grouped.map(([name, list]) => (
        <div key={name}>
          <div style={{ display: "flex", gap: 9, alignItems: "baseline" }}>
            <span style={{ fontSize: 14, color: C.bone }}>{name}</span>
            <Mono style={{ fontSize: 10, color: C.dim }}>{list.length} 条用法</Mono>
          </div>
          <div style={{ marginTop: 7, display: "flex", flexDirection: "column", gap: 5 }}>
            {list.map((e) => (
              <div
                key={e.id}
                style={{
                  background: C.surface,
                  border: `1px solid ${C.edgeSoft}`,
                  borderLeft: `2px solid ${
                    e.confidence === "confirmed" ? C.confirmed : C.inferred
                  }`,
                  borderRadius: 2,
                  padding: "8px 11px",
                  display: "flex",
                  gap: 10,
                }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div
                    style={{ display: "flex", gap: 7, alignItems: "center", flexWrap: "wrap" }}
                  >
                    <Mono style={{ fontSize: 10, color: C.muted }}>
                      {stepDef(fw, e.step)?.name ?? e.step}
                    </Mono>
                    {e.functionSlots.map((s) => (
                      <Mono
                        key={s}
                        style={{
                          fontSize: 10,
                          color: C.skeleton,
                          border: `1px solid ${C.edgeSoft}`,
                          borderRadius: 2,
                          padding: "1px 6px",
                        }}
                      >
                        {s}
                      </Mono>
                    ))}
                    <ConfidenceTag value={e.confidence} />
                  </div>
                  {e.rationale && (
                    <div
                      style={{
                        fontSize: 11.5,
                        color: C.muted,
                        lineHeight: 1.65,
                        marginTop: 5,
                      }}
                    >
                      {e.rationale}
                    </div>
                  )}
                </div>
                {(e.authorId === auth.user.id || auth.role === "admin") && (
                  <button
                    onClick={async () => {
                      await api.deleteIngredient(e.id);
                      onChanged();
                    }}
                    style={{
                      background: "none",
                      border: "none",
                      color: C.dim,
                      cursor: "pointer",
                      fontSize: 13,
                      flexShrink: 0,
                      alignSelf: "flex-start",
                    }}
                  >
                    ×
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
