import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  AuthContext,
  Card,
  CardType,
  FrameworkConfig,
  IngredientEntry,
  InputMode,
  LibraryItem,
  SearchResults,
  StepKey,
} from "@shared/types";
import * as api from "./api";
import { ApiError, setAuthToken } from "./api";
import { CardTile } from "./components/CardTile";
import { Composer } from "./components/Composer";
import { DesignCardView } from "./components/DesignCardView";
import { FrameworkEditor } from "./components/FrameworkEditor";
import { LibraryPanel } from "./components/LibraryPanel";
import { Login } from "./components/Login";
import { Btn, Empty, ErrorBar, Mono, SectionLabel } from "./components/primitives";
import { TeamPanel } from "./components/TeamPanel";
import { TeardownCardView } from "./components/TeardownCardView";
import { C, inputStyle, mono, serif } from "./theme";

export default function App() {
  const [auth, setAuth] = useState<AuthContext | null>(null);
  const [booting, setBooting] = useState(true);
  const [caps, setCaps] = useState({ ai: false, serverStt: false });

  const [fw, setFw] = useState<FrameworkConfig | null>(null);
  const [cards, setCards] = useState<Card[]>([]);
  const [library, setLibrary] = useState<LibraryItem[]>([]);
  const [ingredients, setIngredients] = useState<IngredientEntry[]>([]);

  const [openId, setOpenId] = useState<string | null>(null);
  const [currentStep, setCurrentStep] = useState<StepKey | null>(null);
  const [seed, setSeed] = useState("");
  const [newType, setNewType] = useState<CardType>("design");
  const [q, setQ] = useState("");
  const [results, setResults] = useState<SearchResults | null>(null);
  const [showFramework, setShowFramework] = useState(false);
  const [showTeam, setShowTeam] = useState(false);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  /* ---------- 启动 ---------- */

  useEffect(() => {
    void (async () => {
      try {
        setCaps(await api.getCapabilities());
      } catch {
        /* 服务端没起来也让登录页显示出来 */
      }
      try {
        const a = await api.me();
        setAuth(a);
      } catch {
        setAuthToken(null);
      } finally {
        setBooting(false);
      }
    })();
  }, []);

  const refreshAll = useCallback(async () => {
    try {
      const [f, c, l, i] = await Promise.all([
        api.getFramework(),
        api.getCards(),
        api.getLibrary(),
        api.getIngredients(),
      ]);
      setFw(f);
      setCards(c);
      setLibrary(l);
      setIngredients(i);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "加载失败");
    }
  }, []);

  useEffect(() => {
    if (auth) void refreshAll();
  }, [auth, refreshAll]);

  const refreshLibrary = useCallback(() => {
    void Promise.all([api.getLibrary(), api.getIngredients()]).then(([l, i]) => {
      setLibrary(l);
      setIngredients(i);
    });
  }, []);

  /* ---------- 检索 ---------- */

  useEffect(() => {
    if (!auth) return;
    const term = q.trim();
    if (!term) {
      setResults(null);
      return;
    }
    const t = window.setTimeout(() => {
      void api
        .search(term)
        .then(setResults)
        .catch(() => setResults(null));
    }, 220);
    return () => clearTimeout(t);
  }, [q, auth]);

  /* ---------- 卡片操作 ---------- */

  const open = useMemo(() => cards.find((c) => c.id === openId) ?? null, [cards, openId]);

  const replaceCard = useCallback((next: Card) => {
    setCards((cs) => {
      const i = cs.findIndex((c) => c.id === next.id);
      if (i < 0) return [next, ...cs];
      const out = [...cs];
      out[i] = next;
      return out;
    });
  }, []);

  const patchOpen = useCallback(
    async (p: Partial<Card>) => {
      if (!open) return;
      try {
        replaceCard(await api.patchCard(open.id, open.rev, p));
      } catch (e) {
        if (e instanceof ApiError && e.isConflict) {
          replaceCard(await api.getCard(open.id));
          setErr("这张卡刚被其他人改过,已经刷新成最新的。再改一次。");
        } else {
          setErr(e instanceof Error ? e.message : "保存失败");
        }
      }
    },
    [open, replaceCard],
  );

  const startCard = async (text: string, inputMode: InputMode) => {
    if (!text.trim()) return;
    setBusy(true);
    setErr("");
    try {
      const card = await api.createCard({
        type: newType,
        origin: text.trim(),
        inputMode,
      });
      replaceCard(card);
      setSeed("");
      setOpenId(card.id);
      setCurrentStep(null);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "开卡失败");
    } finally {
      setBusy(false);
    }
  };

  /* ---------- 多人接力:打开的卡片轮询 ---------- */

  useEffect(() => {
    if (!openId) return;
    const timer = window.setInterval(() => {
      void api
        .getCard(openId)
        .then((fresh) => {
          setCards((cs) => {
            const local = cs.find((c) => c.id === fresh.id);
            if (local && local.rev === fresh.rev) return cs;
            return cs.map((c) => (c.id === fresh.id ? fresh : c));
          });
        })
        .catch(() => {});
    }, 8000);
    return () => clearInterval(timer);
  }, [openId]);

  /* ---------- 渲染 ---------- */

  if (booting) {
    return (
      <Shell>
        <div style={{ padding: 40, color: C.dim, fontSize: 13 }}>载入中…</div>
      </Shell>
    );
  }

  if (!auth) {
    return (
      <Shell>
        <Login onDone={setAuth} />
      </Shell>
    );
  }

  if (!fw) {
    return (
      <Shell>
        <div style={{ padding: 40, color: C.dim, fontSize: 13 }}>
          载入框架配置…
          {err && (
            <div style={{ marginTop: 14 }}>
              <ErrorBar text={err} onClose={() => setErr("")} />
            </div>
          )}
        </div>
      </Shell>
    );
  }

  return (
    <Shell full={Boolean(open)}>
      {open ? (
        open.type === "teardown" ? (
          <TeardownCardView
            card={open}
            fw={fw}
            auth={auth}
            serverStt={caps.serverStt}
            onCardChange={replaceCard}
            onPatch={patchOpen}
            onBack={() => {
              setOpenId(null);
              setCurrentStep(null);
            }}
            currentStep={currentStep}
            onStepFocus={setCurrentStep}
            onSpawnDesign={(c) => {
              replaceCard(c);
              setOpenId(c.id);
              setCurrentStep(null);
            }}
          />
        ) : (
          <DesignCardView
            card={open}
            fw={fw}
            auth={auth}
            serverStt={caps.serverStt}
            onCardChange={replaceCard}
            onPatch={patchOpen}
            onBack={() => {
              setOpenId(null);
              setCurrentStep(null);
            }}
            currentStep={currentStep}
            onStepFocus={setCurrentStep}
          />
        )
      ) : (
        <>
          {/* 头部 */}
          <div style={{ padding: "34px 0 22px" }}>
            <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <Mono style={{ fontSize: 9.5, color: C.dim, letterSpacing: "0.22em" }}>
                  骨架 → 香气 → 呈现
                </Mono>
                <h1
                  style={{
                    fontFamily: serif,
                    fontSize: 38,
                    fontWeight: 400,
                    margin: "10px 0 0",
                    letterSpacing: "0.01em",
                    lineHeight: 1.15,
                    color: C.bone,
                  }}
                >
                  风味设计工作台
                </h1>
                <div
                  style={{ fontSize: 12.5, color: C.muted, marginTop: 9, lineHeight: 1.8 }}
                >
                  一张卡片 = 一个方案 = 一场可中断可续接的对话。
                  {fw.steps.length} 步是 {fw.steps.length} 个必须点亮的槽,顺序随你。
                </div>
              </div>

              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: 6,
                  alignItems: "flex-end",
                  flexShrink: 0,
                }}
              >
                <Mono style={{ fontSize: 10, color: C.dim }}>{auth.user.name}</Mono>
                <div style={{ display: "flex", gap: 6 }}>
                  <Btn onClick={() => setShowTeam(true)} style={{ padding: "5px 9px" }}>
                    团队
                  </Btn>
                  <Btn
                    onClick={() => setShowFramework(true)}
                    style={{ padding: "5px 9px" }}
                    title={`框架 v${fw.version} · ${fw.steps.length} 步`}
                  >
                    框架 v{fw.version}
                  </Btn>
                  <Btn
                    onClick={async () => {
                      await api.logout().catch(() => {});
                      setAuthToken(null);
                      setAuth(null);
                    }}
                    style={{ padding: "5px 9px" }}
                  >
                    退出
                  </Btn>
                </div>
              </div>
            </div>
          </div>

          {!caps.ai && (
            <div style={{ marginBottom: 14 }}>
              <ErrorBar text="服务端没有配置 ANTHROPIC_API_KEY —— 卡片可以开、库可以记,但推演不可用。" />
            </div>
          )}
          {err && (
            <div style={{ marginBottom: 14 }}>
              <ErrorBar text={err} onClose={() => setErr("")} />
            </div>
          )}

          {/* 新建卡片 —— 语音是主入口 */}
          <div
            style={{
              border: `1px solid ${C.edgeSoft}`,
              borderRadius: 3,
              padding: "13px 14px",
              background: C.surface,
            }}
          >
            <div style={{ display: "flex", gap: 6, marginBottom: 11 }}>
              {(
                [
                  ["design", "设计一杯新的"],
                  ["teardown", "拆解一杯喝过的"],
                ] as const
              ).map(([t, label]) => (
                <button
                  key={t}
                  onClick={() => setNewType(t)}
                  style={{
                    background: newType === t ? "rgba(255,255,255,.05)" : "transparent",
                    border: `1px solid ${newType === t ? (t === "design" ? C.tea : C.skeleton) : C.edgeSoft}`,
                    color: newType === t ? (t === "design" ? C.tea : C.skeleton) : C.dim,
                    borderRadius: 2,
                    padding: "5px 11px",
                    fontSize: 11.5,
                    cursor: "pointer",
                  }}
                >
                  {label}
                </button>
              ))}
            </div>

            <Composer
              value={seed}
              onChange={setSeed}
              onSubmit={(text, mode) => startCard(text, mode)}
              submitLabel="开一张卡"
              busy={busy}
              serverSttEnabled={caps.serverStt}
              placeholder={
                newType === "design"
                  ? "今天喝到了什么,或者想到了什么 — 蜜瓜 抹茶 黑松露"
                  : "刚喝到什么?先把感受说出来 — 第一口是番茄,然后茶味上来…"
              }
            />
          </div>

          {/* 全局检索 */}
          <div style={{ marginTop: 24 }}>
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="检索卡片、对话、结论、搁置项、参考库、原料条目"
              style={{ ...inputStyle, background: "transparent", borderColor: C.edgeSoft }}
            />
          </div>

          {results ? (
            <SearchView
              results={results}
              fw={fw}
              onOpen={(id, step) => {
                setOpenId(id);
                setCurrentStep(step ?? null);
              }}
            />
          ) : (
            <>
              <div style={{ marginTop: 24 }}>
                {cards.length === 0 ? (
                  <Empty>
                    还没有卡片。
                    <br />
                    说一个起点就能开一张 — 从香气、从画面、从一句概念都行。
                  </Empty>
                ) : (
                  <div className="fw-grid">
                    {cards.map((c) => (
                      <CardTile
                        key={c.id}
                        card={c}
                        fw={fw}
                        currentUserId={auth.user.id}
                        onOpen={(id) => {
                          setOpenId(id);
                          setCurrentStep(null);
                        }}
                      />
                    ))}
                  </div>
                )}
              </div>

              <LibraryPanel
                fw={fw}
                auth={auth}
                library={library}
                ingredients={ingredients}
                aiEnabled={caps.ai}
                onChanged={refreshLibrary}
              />
            </>
          )}
        </>
      )}

      {showFramework && (
        <FrameworkEditor
          fw={fw}
          auth={auth}
          onClose={() => setShowFramework(false)}
          onSaved={(next) => {
            setFw(next);
            setShowFramework(false);
          }}
        />
      )}
      {showTeam && <TeamPanel auth={auth} onClose={() => setShowTeam(false)} />}
    </Shell>
  );
}

function Shell({ children, full }: { children: React.ReactNode; full?: boolean }) {
  return (
    <div
      style={{
        background: C.ink,
        minHeight: "100vh",
        color: C.bone,
        fontFamily:
          "-apple-system, BlinkMacSystemFont, 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', system-ui, sans-serif",
      }}
    >
      <div
        style={{
          maxWidth: 1080,
          margin: "0 auto",
          padding: "0 20px 60px",
          height: full ? "100vh" : "auto",
          display: "flex",
          flexDirection: "column",
        }}
      >
        {children}
      </div>
    </div>
  );
}

function SearchView({
  results,
  fw,
  onOpen,
}: {
  results: SearchResults;
  fw: FrameworkConfig;
  onOpen: (id: string, step?: StepKey) => void;
}) {
  const empty =
    !results.cards.length && !results.library.length && !results.ingredients.length;

  if (empty) {
    return (
      <div style={{ fontSize: 12.5, color: C.dim, padding: "20px 0" }}>
        没有命中。换个词试试。
      </div>
    );
  }

  return (
    <div style={{ marginTop: 20, display: "flex", flexDirection: "column", gap: 20 }}>
      {results.cards.map(({ card, hits }) => (
        <div key={card.id}>
          <div
            onClick={() => onOpen(card.id)}
            style={{
              fontFamily: serif,
              fontSize: 17,
              color: C.bone,
              cursor: "pointer",
              display: "flex",
              gap: 9,
              alignItems: "baseline",
            }}
          >
            {card.name || "未命名"}
            <Mono
              style={{
                fontSize: 9.5,
                color: card.type === "teardown" ? C.skeleton : C.dim,
              }}
            >
              {card.type === "teardown" ? "拆解卡" : "设计卡"}
            </Mono>
          </div>
          <div style={{ marginTop: 6, display: "flex", flexDirection: "column", gap: 5 }}>
            {hits.map((h, i) => (
              <div
                key={i}
                onClick={() => onOpen(card.id, h.step)}
                style={{
                  display: "flex",
                  gap: 10,
                  cursor: "pointer",
                  borderLeft: `1px solid ${C.edge}`,
                  paddingLeft: 10,
                }}
              >
                <Mono
                  style={{ fontSize: 10, color: C.dim, flexShrink: 0, paddingTop: 2 }}
                >
                  {h.where}
                </Mono>
                <div
                  style={{
                    fontSize: 12,
                    color: C.muted,
                    lineHeight: 1.65,
                    display: "-webkit-box",
                    WebkitLineClamp: 2,
                    WebkitBoxOrient: "vertical",
                    overflow: "hidden",
                  }}
                >
                  {h.text}
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}

      {results.ingredients.length > 0 && (
        <div>
          <SectionLabel color={C.alcohol}>原料条目</SectionLabel>
          <div style={{ marginTop: 7, display: "flex", flexDirection: "column", gap: 5 }}>
            {results.ingredients.map((e) => (
              <div
                key={e.id}
                onClick={() => onOpen(e.sourceCardId, e.step)}
                style={{
                  borderLeft: `1px solid ${C.edge}`,
                  paddingLeft: 10,
                  cursor: "pointer",
                }}
              >
                <div style={{ fontSize: 12.5, color: C.bone }}>
                  {e.name}
                  <Mono style={{ fontSize: 10, color: C.dim, marginLeft: 8 }}>
                    {fw.steps.find((s) => s.key === e.step)?.name ?? e.step}
                    {e.functionSlots.length ? ` · ${e.functionSlots.join("+")}` : ""}
                  </Mono>
                </div>
                <div style={{ fontSize: 11.5, color: C.muted, lineHeight: 1.6 }}>
                  {e.rationale}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {results.library.length > 0 && (
        <div>
          <SectionLabel color={C.skeleton}>参考库</SectionLabel>
          <div style={{ marginTop: 7, display: "flex", flexDirection: "column", gap: 5 }}>
            {results.library.map((l) => (
              <div key={l.id} style={{ borderLeft: `1px solid ${C.edge}`, paddingLeft: 10 }}>
                <div style={{ fontSize: 12.5, color: C.bone }}>
                  {l.title}
                  <Mono style={{ fontSize: 10, color: C.dim, marginLeft: 8 }}>
                    {fw.taxonomies.libraryTypes.find((t) => t.key === l.type)?.label ??
                      l.type}
                  </Mono>
                </div>
                <div style={{ fontSize: 11.5, color: C.muted, lineHeight: 1.6 }}>
                  {l.content.slice(0, 140)}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
