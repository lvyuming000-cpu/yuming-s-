import { useEffect, useRef, useState } from "react";
import type {
  AuthContext,
  Card,
  FrameworkConfig,
  InputMode,
  ProposeConfirm,
  StepKey,
} from "@shared/types";
import { accentColor, canEdit, stepDef } from "@shared/util";
import * as api from "../api";
import { C } from "../theme";
import { Composer } from "./Composer";
import { Btn, ErrorBar, Mono } from "./primitives";

/* 对话流 —— 设计卡和拆解卡共用。封步逻辑两者相同(§4.5) */

export function Conversation({
  card,
  fw,
  auth,
  serverStt,
  onCardChange,
  onStepFocus,
  emptyHint,
}: {
  card: Card;
  fw: FrameworkConfig;
  auth: AuthContext;
  serverStt: boolean;
  onCardChange: (c: Card) => void;
  onStepFocus: (key: StepKey) => void;
  emptyHint: string;
}) {
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [confirmBox, setConfirmBox] = useState<ProposeConfirm | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const writable = canEdit(card, auth.user.id, auth.role);
  const accent = accentColor(card, fw);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [card.messages.length, busy]);

  const send = async (text: string, inputMode: InputMode) => {
    setErr("");
    setDraft("");
    setBusy(true);
    try {
      const out = await api.sendTurn(card.id, text, inputMode);
      onCardChange(out.card);
      if (out.currentStep) onStepFocus(out.currentStep);
      setConfirmBox(out.proposeConfirm);
    } catch (e) {
      setDraft(text); // 失败不吞用户的话
      setErr(e instanceof Error ? e.message : "这轮没接上,再发一次");
    } finally {
      setBusy(false);
    }
  };

  const acceptConfirm = async () => {
    if (!confirmBox) return;
    setBusy(true);
    try {
      onCardChange(
        await api.confirmStep(
          card.id,
          confirmBox.step,
          confirmBox.conclusion,
          confirmBox.unresolved,
        ),
      );
      setConfirmBox(null);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "封步失败");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0, minHeight: 0 }}
    >
      <div ref={scrollRef} style={{ flex: 1, overflowY: "auto", padding: "18px 2px 12px" }}>
        {card.messages.length === 0 && (
          <div style={{ color: C.dim, fontSize: 13, lineHeight: 1.9, paddingTop: 20 }}>
            {emptyHint}
          </div>
        )}

        {card.messages.map((m) => (
          <div key={m.id} style={{ marginBottom: 22 }}>
            <div style={{ display: "flex", gap: 8, alignItems: "baseline" }}>
              <Mono
                style={{
                  fontSize: 9.5,
                  color: m.role === "user" ? C.dim : accent,
                  letterSpacing: "0.14em",
                }}
              >
                {m.role === "user" ? "你" : "推演"}
              </Mono>
              {m.inputMode === "voice" && (
                <Mono style={{ fontSize: 9, color: C.dim }}>◉ 语音</Mono>
              )}
              {m.authorId && m.authorId !== auth.user.id && (
                <Mono style={{ fontSize: 9, color: C.skeleton }}>队友</Mono>
              )}
            </div>

            <div
              style={{
                fontSize: 13.5,
                color: C.bone,
                lineHeight: 1.85,
                marginTop: 6,
                whiteSpace: "pre-wrap",
                opacity: m.role === "user" ? 0.82 : 1,
                borderLeft: m.role === "user" ? `1px solid ${C.edge}` : "none",
                paddingLeft: m.role === "user" ? 11 : 0,
              }}
            >
              {m.content}
            </div>

            {/* 原料级主动提示 —— 与正文区分显示(§5.5) */}
            {m.ingredientAlerts?.map((alert, j) => (
              <div
                key={j}
                style={{
                  marginTop: 9,
                  border: `1px solid ${C.alcohol}`,
                  borderLeft: `3px solid ${C.alcohol}`,
                  background: "rgba(222,154,85,.06)",
                  borderRadius: 2,
                  padding: "9px 11px",
                }}
              >
                <Mono style={{ fontSize: 9, color: C.alcohol, letterSpacing: "0.14em" }}>
                  库里有这个原料的历史用法
                </Mono>
                <div style={{ fontSize: 12.5, color: C.bone, lineHeight: 1.7, marginTop: 5 }}>
                  {alert}
                </div>
              </div>
            ))}

            {/* 来源标签 —— 一眼看出是现想的还是从库里翻的(§5.2) */}
            {m.sources && m.sources.length > 0 && (
              <div style={{ marginTop: 8, display: "flex", gap: 6, flexWrap: "wrap" }}>
                {m.sources.map((s, j) => (
                  <Mono
                    key={j}
                    style={{
                      fontSize: 10,
                      color: C.skeleton,
                      border: `1px solid ${C.edgeSoft}`,
                      borderRadius: 2,
                      padding: "2px 7px",
                    }}
                  >
                    库 · {s}
                  </Mono>
                ))}
              </div>
            )}
          </div>
        ))}

        {busy && (
          <Mono style={{ fontSize: 11, color: C.dim, letterSpacing: "0.1em" }}>推演中…</Mono>
        )}
        {err && (
          <div style={{ marginTop: 8 }}>
            <ErrorBar text={err} onClose={() => setErr("")} />
          </div>
        )}

        {/* 封步确认块 —— AI 提议,用户拍板(§3.5) */}
        {confirmBox && (
          <div
            style={{
              border: `1px solid ${accent}`,
              borderRadius: 2,
              padding: "14px 15px",
              marginTop: 4,
              background: "rgba(255,255,255,.02)",
            }}
          >
            <Mono style={{ fontSize: 9.5, color: accent, letterSpacing: "0.14em" }}>
              提议封步 · {stepDef(fw, confirmBox.step)?.name ?? confirmBox.step}
            </Mono>
            <div style={{ fontSize: 13, color: C.bone, lineHeight: 1.8, marginTop: 9 }}>
              结论:{confirmBox.conclusion}
            </div>
            {confirmBox.unresolved && (
              <div style={{ fontSize: 12, color: C.muted, lineHeight: 1.75, marginTop: 7 }}>
                还有「{confirmBox.unresolved}」没定,不影响往下走 — 会存进搁置项。
              </div>
            )}
            <div style={{ display: "flex", gap: 7, marginTop: 13 }}>
              <Btn
                onClick={() => void acceptConfirm()}
                tone="solid"
                disabled={busy || !writable}
              >
                同意,封了
              </Btn>
              <Btn
                onClick={() => {
                  setConfirmBox(null);
                  void send("先别封,继续讨论这一步", "text");
                }}
                disabled={busy || !writable}
              >
                继续讨论
              </Btn>
            </div>
          </div>
        )}
      </div>

      <div style={{ borderTop: `1px solid ${C.edgeSoft}`, padding: "12px 0 4px" }}>
        {writable ? (
          <Composer
            value={draft}
            onChange={setDraft}
            onSubmit={send}
            busy={busy}
            serverSttEnabled={serverStt}
          />
        ) : (
          <Mono style={{ fontSize: 11, color: C.dim }}>
            这张卡对你只读 —— 卡主把它设成了「团队可见」而不是「团队可编辑」
          </Mono>
        )}
      </div>
    </div>
  );
}
