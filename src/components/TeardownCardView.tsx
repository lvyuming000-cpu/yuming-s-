import { useState } from "react";
import type {
  AuthContext,
  Card,
  FrameworkConfig,
  StepKey,
  TeardownData,
} from "@shared/types";
import { canEdit, stepDef } from "@shared/util";
import * as api from "../api";
import { C, inputStyle, mono } from "../theme";
import { CardShell } from "./CardShell";
import { Composer } from "./Composer";
import { Conversation } from "./Conversation";
import { Btn, ConfidenceTag, ErrorBar, Mono, SectionLabel } from "./primitives";

/* ============================================================
   拆解卡(§4)
   ------------------------------------------------------------
   核心是双栏输入必须分开存:
   - 【感受】主观,语音为主
   - 【原料】客观,店家给的清单
   合并成一栏就丢掉了两者的落差 —— 而真正有价值的东西恰恰在落差里。
   ============================================================ */

export function TeardownCardView({
  card,
  fw,
  auth,
  serverStt,
  onCardChange,
  onPatch,
  onBack,
  currentStep,
  onStepFocus,
  onSpawnDesign,
}: {
  card: Card;
  fw: FrameworkConfig;
  auth: AuthContext;
  serverStt: boolean;
  onCardChange: (c: Card) => void;
  onPatch: (p: Partial<Card>) => void;
  onBack: () => void;
  currentStep: StepKey | null;
  onStepFocus: (k: StepKey) => void;
  onSpawnDesign: (c: Card) => void;
}) {
  const [tab, setTab] = useState<"teardown" | "chat">("teardown");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const td: TeardownData = card.teardown ?? {
    sourceName: "",
    perception: "",
    ingredients: [],
    gapAnalysis: null,
    placements: [],
    whyItWorks: "",
    whyItWorksConfidence: "inferred",
    borrowable: "",
  };
  const writable = canEdit(card, auth.user.id, auth.role);

  const analyze = async () => {
    setBusy(true);
    setErr("");
    try {
      onCardChange(await api.analyzeTeardown(card.id));
    } catch (e) {
      setErr(e instanceof Error ? e.message : "分析失败");
    } finally {
      setBusy(false);
    }
  };

  const spawn = async () => {
    setBusy(true);
    setErr("");
    try {
      onSpawnDesign(await api.spawnDesignCard(card.id));
    } catch (e) {
      setErr(e instanceof Error ? e.message : "派生失败");
    } finally {
      setBusy(false);
    }
  };

  return (
    <CardShell
      card={card}
      fw={fw}
      auth={auth}
      currentStep={currentStep}
      onStepFocus={onStepFocus}
      onPatch={onPatch}
      onBack={onBack}
      sidebarExtra={
        <>
          <Btn
            onClick={() => void analyze()}
            disabled={busy || !writable || (!td.perception.trim() && !td.ingredients.length)}
            tone="accent"
          >
            {busy ? "分析中…" : td.analyzedAt ? "重新分析" : "开始拆解"}
          </Btn>
          {td.borrowable && (
            <Btn onClick={() => void spawn()} disabled={busy || !writable}>
              用可借用的部分开一张设计卡
            </Btn>
          )}
          {err && <ErrorBar text={err} onClose={() => setErr("")} />}
        </>
      }
    >
      <div
        style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0, minHeight: 0 }}
      >
        <div style={{ display: "flex", gap: 6, padding: "12px 0 4px" }}>
          {(["teardown", "chat"] as const).map((t) => (
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
              {t === "teardown" ? "拆解" : "对话"}
            </button>
          ))}
        </div>

        {tab === "chat" ? (
          <Conversation
            card={card}
            fw={fw}
            auth={auth}
            serverStt={serverStt}
            onCardChange={onCardChange}
            onStepFocus={onStepFocus}
            emptyHint={"拆解完可以在这里继续追问。\n封步的结论写「这一步在那杯里是怎么实现的」,不是「我们决定怎么做」。"}
          />
        ) : (
          <div style={{ flex: 1, overflowY: "auto", paddingBottom: 24 }}>
            <TeardownInputs
              td={td}
              writable={writable}
              serverStt={serverStt}
              onChange={(next) => onPatch({ teardown: next })}
            />
            {td.analyzedAt && (
              <TeardownResults td={td} fw={fw} />
            )}
          </div>
        )}
      </div>
    </CardShell>
  );
}

/* ---------------- 双栏输入 ---------------- */

function TeardownInputs({
  td,
  writable,
  serverStt,
  onChange,
}: {
  td: TeardownData;
  writable: boolean;
  serverStt: boolean;
  onChange: (next: TeardownData) => void;
}) {
  const [perceptionDraft, setPerceptionDraft] = useState(td.perception);
  const [ingredientDraft, setIngredientDraft] = useState("");
  const [sourceName, setSourceName] = useState(td.sourceName);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20, paddingTop: 8 }}>
      <div>
        <SectionLabel>这杯东西叫什么、在哪喝的</SectionLabel>
        <input
          value={sourceName}
          disabled={!writable}
          onChange={(e) => setSourceName(e.target.value)}
          onBlur={() =>
            sourceName !== td.sourceName && onChange({ ...td, sourceName })
          }
          placeholder="如「某某酒吧 · 番茄清饮」"
          style={{ ...inputStyle, marginTop: 8, background: C.surface }}
        />
      </div>

      <div className="fw-teardown-cols">
        {/* 感受栏 —— 语音为主 */}
        <div>
          <SectionLabel color={C.tea}>【感受】你尝到什么 · 主观</SectionLabel>
          <div style={{ fontSize: 11, color: C.dim, lineHeight: 1.7, margin: "6px 0 9px" }}>
            说出来就行 —— 第一口是什么、泡沫什么感觉、尾巴留下什么。碎的、不成句的都可以。
          </div>
          <Composer
            value={perceptionDraft}
            onChange={setPerceptionDraft}
            serverSttEnabled={serverStt}
            disabled={!writable}
            rows={5}
            minHeight={120}
            placeholder="第一口是番茄,然后茶味上来,泡沫很轻…"
            onInputModeChange={(mode) =>
              onChange({ ...td, perceptionInputMode: mode })
            }
          />
          <div style={{ marginTop: 8 }}>
            <Btn
              onClick={() => onChange({ ...td, perception: perceptionDraft })}
              disabled={!writable || perceptionDraft === td.perception}
              tone="ghost"
            >
              保存感受
            </Btn>
          </div>
        </div>

        {/* 原料栏 —— 打字为主 */}
        <div>
          <SectionLabel color={C.alcohol}>【原料】店家说了什么 · 客观</SectionLabel>
          <div style={{ fontSize: 11, color: C.dim, lineHeight: 1.7, margin: "6px 0 9px" }}>
            一行一个。这一栏和感受栏分开存 —— 有价值的东西在两者的落差里。
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <input
              value={ingredientDraft}
              disabled={!writable}
              onChange={(e) => setIngredientDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && ingredientDraft.trim()) {
                  onChange({
                    ...td,
                    ingredients: [...td.ingredients, ingredientDraft.trim()],
                  });
                  setIngredientDraft("");
                }
              }}
              placeholder="输入原料名,回车添加"
              style={{ ...inputStyle, background: C.surface }}
            />
            <Btn
              onClick={() => {
                if (!ingredientDraft.trim()) return;
                onChange({
                  ...td,
                  ingredients: [...td.ingredients, ingredientDraft.trim()],
                });
                setIngredientDraft("");
              }}
              disabled={!writable || !ingredientDraft.trim()}
            >
              加
            </Btn>
          </div>

          <div
            style={{ marginTop: 10, display: "flex", flexWrap: "wrap", gap: 6 }}
          >
            {td.ingredients.map((ing, i) => (
              <span
                key={`${ing}-${i}`}
                style={{
                  border: `1px solid ${C.edge}`,
                  borderRadius: 2,
                  padding: "4px 8px",
                  fontSize: 12,
                  color: C.bone,
                  display: "inline-flex",
                  gap: 7,
                  alignItems: "center",
                }}
              >
                {ing}
                {writable && (
                  <button
                    onClick={() =>
                      onChange({
                        ...td,
                        ingredients: td.ingredients.filter((_, j) => j !== i),
                      })
                    }
                    style={{
                      background: "none",
                      border: "none",
                      color: C.dim,
                      cursor: "pointer",
                      fontSize: 12,
                      padding: 0,
                    }}
                  >
                    ×
                  </button>
                )}
              </span>
            ))}
            {!td.ingredients.length && (
              <Mono style={{ fontSize: 11, color: C.dim }}>还没有原料</Mono>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ---------------- 三段式产出 ---------------- */

function TeardownResults({ td, fw }: { td: TeardownData; fw: FrameworkConfig }) {
  const g = fw.teardown.gapLabels;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24, marginTop: 28 }}>
      {/* 1. 落差分析 —— 高价值项高亮 */}
      {td.gapAnalysis && (
        <div>
          <SectionLabel>落差分析 / GAP</SectionLabel>
          <div
            style={{
              display: "grid",
              gap: 10,
              marginTop: 10,
              gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
            }}
          >
            <GapColumn
              label={g.tastedAndListed}
              items={td.gapAnalysis.tastedAndListed}
              color={C.edge}
            />
            <GapColumn
              label={g.listedNotTasted}
              items={td.gapAnalysis.listedNotTasted}
              color={C.inferred}
              highlight
              note="大概率是桥接剂或结构性成分"
            />
            <GapColumn
              label={g.tastedNotListed}
              items={td.gapAnalysis.tastedNotListed}
              color={C.tea}
              highlight
              note="是组合产生的,不是某个原料带来的"
            />
          </div>
        </div>
      )}

      {/* 2. 归位 */}
      {td.placements.length > 0 && (
        <div>
          <SectionLabel>归位 / PLACEMENT</SectionLabel>
          <div
            style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 7 }}
          >
            {td.placements.map((p) => (
              <div
                key={p.id}
                style={{
                  background: C.surface,
                  border: `1px solid ${C.edgeSoft}`,
                  borderLeft: `2px solid ${
                    p.confidence === "confirmed" ? C.confirmed : C.inferred
                  }`,
                  borderRadius: 2,
                  padding: "10px 12px",
                }}
              >
                <div
                  style={{ display: "flex", gap: 9, alignItems: "center", flexWrap: "wrap" }}
                >
                  <span style={{ fontSize: 13, color: C.bone }}>{p.ingredient}</span>
                  <Mono style={{ fontSize: 10, color: C.muted }}>
                    {stepDef(fw, p.step)?.name ?? p.step}
                  </Mono>
                  {p.functionSlots.map((s) => (
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
                  <span style={{ marginLeft: "auto" }}>
                    <ConfidenceTag value={p.confidence} />
                  </span>
                </div>
                {p.rationale && (
                  <div
                    style={{
                      fontSize: 12,
                      color: C.muted,
                      lineHeight: 1.7,
                      marginTop: 6,
                    }}
                  >
                    {p.rationale}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 3. 为什么好喝 */}
      {td.whyItWorks && (
        <div>
          <div style={{ display: "flex", gap: 9, alignItems: "center" }}>
            <SectionLabel>为什么好喝 / WHY</SectionLabel>
            <ConfidenceTag value={td.whyItWorksConfidence} />
          </div>
          <div
            style={{
              fontSize: 13,
              color: C.bone,
              lineHeight: 1.9,
              marginTop: 9,
              whiteSpace: "pre-wrap",
            }}
          >
            {td.whyItWorks}
          </div>
        </div>
      )}

      {td.borrowable && (
        <div>
          <SectionLabel color={C.tea}>可借用 / BORROWABLE</SectionLabel>
          <div
            style={{
              fontSize: 13,
              color: C.bone,
              lineHeight: 1.9,
              marginTop: 9,
              whiteSpace: "pre-wrap",
            }}
          >
            {td.borrowable}
          </div>
        </div>
      )}

      <div style={{ fontSize: 11, color: C.dim, lineHeight: 1.75 }}>
        标「推测」的是 AI 的推理,不是事实 —— 隐形成分你本来就尝不出来。
        这些结论会进参考库,把猜测当事实存进去会被放大。
      </div>
    </div>
  );
}

function GapColumn({
  label,
  items,
  color,
  highlight,
  note,
}: {
  label: string;
  items: string[];
  color: string;
  highlight?: boolean;
  note?: string;
}) {
  return (
    <div
      style={{
        border: `1px solid ${highlight ? color : C.edgeSoft}`,
        background: highlight ? "rgba(255,255,255,.025)" : "transparent",
        borderRadius: 2,
        padding: "11px 12px",
      }}
    >
      <Mono style={{ fontSize: 10, color, letterSpacing: "0.08em" }}>{label}</Mono>
      {note && (
        <div style={{ fontSize: 10.5, color: C.dim, marginTop: 4, lineHeight: 1.55 }}>
          {note}
        </div>
      )}
      <div style={{ marginTop: 9, display: "flex", flexDirection: "column", gap: 5 }}>
        {items.length ? (
          items.map((it, i) => (
            <div key={i} style={{ fontSize: 12.5, color: C.bone, lineHeight: 1.6 }}>
              {it}
            </div>
          ))
        ) : (
          <Mono style={{ fontSize: 11, color: C.dim }}>无</Mono>
        )}
      </div>
    </div>
  );
}
