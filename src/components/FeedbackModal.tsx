import { useState } from "react";
import type { Card, Feedback } from "@shared/types";
import * as api from "../api";
import { C, inputStyle } from "../theme";
import { Btn, ErrorBar, Modal, Mono } from "./primitives";

/* 「为什么」这一栏比评分重要 —— UI 上不能做成只有星级(§2.2) */

export function FeedbackModal({
  card,
  onClose,
  onSaved,
}: {
  card: Card;
  onClose: () => void;
  onSaved: (c: Card) => void;
}) {
  const [rating, setRating] = useState<Feedback["rating"]>(card.feedback?.rating ?? 3);
  const [notes, setNotes] = useState(card.feedback?.notes ?? "");
  const [why, setWhy] = useState(card.feedback?.why ?? "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const save = async () => {
    setBusy(true);
    setErr("");
    try {
      const out = await api.saveFeedback(card.id, { rating, notes, why });
      onSaved(out.card);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "保存失败");
      setBusy(false);
    }
  };

  return (
    <Modal onClose={onClose} title="实践反馈">
      <div style={{ fontSize: 12, color: C.muted, lineHeight: 1.8, marginBottom: 16 }}>
        「为什么」这一栏比评分重要。成功配方只说明这样可行,失败机制才能防止下次重蹈覆辙 ——
        写了机制,这条会自动回流进参考库的失败记录,以后每轮必检。
      </div>

      {err && (
        <div style={{ marginBottom: 12 }}>
          <ErrorBar text={err} onClose={() => setErr("")} />
        </div>
      )}

      <Mono style={{ fontSize: 10, color: C.dim, letterSpacing: "0.12em" }}>评分</Mono>
      <div style={{ display: "flex", gap: 7, margin: "9px 0 18px" }}>
        {([1, 2, 3, 4, 5] as const).map((n) => (
          <button
            key={n}
            onClick={() => setRating(n)}
            style={{
              width: 34,
              height: 34,
              borderRadius: 2,
              border: `1px solid ${n <= rating ? C.tea : C.edgeSoft}`,
              background: n <= rating ? "rgba(201,217,79,.08)" : "transparent",
              color: n <= rating ? C.tea : C.dim,
              cursor: "pointer",
              fontSize: 12,
            }}
          >
            {n}
          </button>
        ))}
      </div>

      <Mono style={{ fontSize: 10, color: C.dim, letterSpacing: "0.12em" }}>哪里不行</Mono>
      <textarea
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        rows={2}
        placeholder="实际喝出来和设计的差在哪"
        style={{
          ...inputStyle,
          marginTop: 7,
          marginBottom: 14,
          lineHeight: 1.7,
          resize: "vertical",
        }}
      />

      <Mono style={{ fontSize: 10, color: C.danger, letterSpacing: "0.12em" }}>
        为什么 — 机制
      </Mono>
      <textarea
        value={why}
        onChange={(e) => setWhy(e.target.value)}
        rows={3}
        placeholder="如:松露在低温下香气释放不出来,冰饮里等于没放"
        style={{ ...inputStyle, marginTop: 7, lineHeight: 1.7, resize: "vertical" }}
      />

      <div style={{ marginTop: 18, display: "flex", gap: 8, alignItems: "center" }}>
        <Btn tone="solid" onClick={() => void save()} disabled={busy}>
          {busy ? "保存中…" : "保存"}
        </Btn>
        {!why.trim() && (
          <Mono style={{ fontSize: 10.5, color: C.dim }}>
            机制没写 — 这次就只留个评分,以后 AI 学不到东西
          </Mono>
        )}
      </div>
    </Modal>
  );
}
