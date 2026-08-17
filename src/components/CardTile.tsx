import type { Card, FrameworkConfig } from "@shared/types";
import { accentColor, fmtDate, litCount } from "@shared/util";
import { C, serif } from "../theme";
import { Mono } from "./primitives";
import { SlotBar } from "./Spine";

export function CardTile({
  card,
  fw,
  currentUserId,
  onOpen,
}: {
  card: Card;
  fw: FrameworkConfig;
  currentUserId: string;
  onOpen: (id: string) => void;
}) {
  const accent = accentColor(card, fw);
  const lit = litCount(card, fw);
  const total = fw.steps.length;
  const pending = card.pending.filter((p) => !p.resolved).length;
  const isTeardown = card.type === "teardown";
  const stale = card.frameworkVersion !== fw.version;

  return (
    <div
      onClick={() => onOpen(card.id)}
      style={{
        background: C.surface,
        border: `1px solid ${C.edgeSoft}`,
        borderTop: `2px solid ${isTeardown ? C.skeleton : accent}`,
        borderRadius: 3,
        padding: "14px 15px 13px",
        cursor: "pointer",
        transition: "border-color .18s, transform .18s",
        display: "flex",
        flexDirection: "column",
        gap: 10,
        minHeight: 138,
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.borderColor = C.edge;
        e.currentTarget.style.transform = "translateY(-1px)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.borderColor = C.edgeSoft;
        e.currentTarget.style.transform = "none";
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
        <Mono
          style={{
            fontSize: 9.5,
            color: isTeardown ? C.skeleton : accent,
            letterSpacing: "0.14em",
          }}
        >
          {isTeardown ? "拆解卡" : "设计卡"}
        </Mono>
        <Mono style={{ fontSize: 10, color: C.dim, flexShrink: 0 }}>
          {fmtDate(card.updatedAt)}
        </Mono>
      </div>

      <div
        style={{
          fontFamily: serif,
          fontSize: 19,
          color: C.bone,
          lineHeight: 1.25,
          letterSpacing: "0.01em",
        }}
      >
        {card.name || (isTeardown ? card.teardown?.sourceName || "未命名" : "未命名")}
      </div>

      <div style={{ fontSize: 11.5, color: C.muted, lineHeight: 1.6, flex: 1 }}>
        {(card.origin || "—").slice(0, 64)}
        {(card.origin || "").length > 64 ? "…" : ""}
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <SlotBar card={card} fw={fw} />
        <Mono style={{ fontSize: 10, color: C.dim, marginLeft: "auto" }}>
          {lit}/{total}
        </Mono>
        {card.feedback && (
          <Mono style={{ fontSize: 10, color: accent }}>★{card.feedback.rating}</Mono>
        )}
        {pending > 0 && (
          <Mono style={{ fontSize: 10, color: C.danger, opacity: 0.8 }}>⌇{pending}</Mono>
        )}
      </div>

      <div style={{ display: "flex", gap: 7, alignItems: "center" }}>
        {card.ownerId !== currentUserId && (
          <Mono style={{ fontSize: 9.5, color: C.skeleton }}>团队</Mono>
        )}
        {card.visibility === "private" && (
          <Mono style={{ fontSize: 9.5, color: C.dim }}>私有</Mono>
        )}
        {stale && (
          <Mono
            style={{ fontSize: 9.5, color: C.inferred }}
            // 框架版本不一致时的提示(§6.2)
          >
            框架 v{card.frameworkVersion}
          </Mono>
        )}
      </div>
    </div>
  );
}
