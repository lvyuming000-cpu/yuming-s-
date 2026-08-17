import type { CSSProperties, ReactNode } from "react";
import { C, mono, serif } from "../theme";

export function Mono({
  children,
  style,
}: {
  children: ReactNode;
  style?: CSSProperties;
}) {
  return <span style={{ fontFamily: mono, ...style }}>{children}</span>;
}

export function Serif({
  children,
  style,
}: {
  children: ReactNode;
  style?: CSSProperties;
}) {
  return <span style={{ fontFamily: serif, ...style }}>{children}</span>;
}

type Tone = "ghost" | "solid" | "accent" | "danger";

export function Btn({
  children,
  onClick,
  tone = "ghost",
  disabled,
  style,
  title,
  type = "button",
}: {
  children: ReactNode;
  onClick?: () => void;
  tone?: Tone;
  disabled?: boolean;
  style?: CSSProperties;
  title?: string;
  type?: "button" | "submit";
}) {
  const tones: Record<Tone, { bg: string; fg: string; bd: string }> = {
    ghost: { bg: "transparent", fg: C.muted, bd: C.edge },
    solid: { bg: C.bone, fg: C.ink, bd: C.bone },
    accent: { bg: "transparent", fg: C.tea, bd: C.tea },
    danger: { bg: "transparent", fg: C.danger, bd: C.danger },
  };
  const t = tones[tone];
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      title={title}
      style={{
        background: t.bg,
        color: t.fg,
        border: `1px solid ${t.bd}`,
        borderRadius: 2,
        padding: "7px 13px",
        fontSize: 12.5,
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.4 : 1,
        letterSpacing: "0.03em",
        transition: "all .15s",
        whiteSpace: "nowrap",
        ...style,
      }}
    >
      {children}
    </button>
  );
}

export function Modal({
  children,
  onClose,
  title,
  wide,
}: {
  children: ReactNode;
  onClose: () => void;
  title: string;
  wide?: boolean;
}) {
  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(10,8,12,.72)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 18,
        zIndex: 50,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: C.surface,
          border: `1px solid ${C.edge}`,
          borderRadius: 3,
          maxWidth: wide ? 920 : 640,
          width: "100%",
          maxHeight: "86vh",
          overflowY: "auto",
          padding: "20px 22px 24px",
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            marginBottom: 16,
            position: "sticky",
            top: -20,
            background: C.surface,
            paddingTop: 4,
            paddingBottom: 8,
          }}
        >
          <Mono style={{ fontSize: 10, color: C.muted, letterSpacing: "0.16em" }}>
            {title}
          </Mono>
          <button
            onClick={onClose}
            style={{
              background: "none",
              border: "none",
              color: C.dim,
              cursor: "pointer",
              fontSize: 15,
            }}
          >
            ×
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function SectionLabel({
  children,
  color = C.dim,
}: {
  children: ReactNode;
  color?: string;
}) {
  return (
    <Mono style={{ fontSize: 9.5, color, letterSpacing: "0.16em" }}>{children}</Mono>
  );
}

/** confirmed / inferred 的视觉区分(§4.4 要求 UI 上必须能分辨) */
export function ConfidenceTag({ value }: { value: "confirmed" | "inferred" }) {
  const isConfirmed = value === "confirmed";
  return (
    <Mono
      style={{
        fontSize: 9.5,
        letterSpacing: "0.1em",
        color: isConfirmed ? C.confirmed : C.inferred,
        border: `1px solid ${isConfirmed ? C.confirmed : C.inferred}`,
        borderStyle: isConfirmed ? "solid" : "dashed",
        borderRadius: 2,
        padding: "1px 6px",
        flexShrink: 0,
      }}
    >
      {isConfirmed ? "确认" : "推测"}
    </Mono>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return (
    <div
      style={{
        border: `1px dashed ${C.edgeSoft}`,
        borderRadius: 3,
        padding: "28px 20px",
        textAlign: "center",
        color: C.dim,
        fontSize: 12.5,
        lineHeight: 1.9,
      }}
    >
      {children}
    </div>
  );
}

export function ErrorBar({ text, onClose }: { text: string; onClose?: () => void }) {
  return (
    <div
      style={{
        border: `1px solid ${C.danger}`,
        background: "rgba(217,106,92,.08)",
        borderRadius: 2,
        padding: "8px 11px",
        fontSize: 12,
        color: C.danger,
        lineHeight: 1.6,
        display: "flex",
        gap: 10,
        alignItems: "flex-start",
      }}
    >
      <span style={{ flex: 1 }}>{text}</span>
      {onClose && (
        <button
          onClick={onClose}
          style={{
            background: "none",
            border: "none",
            color: C.danger,
            cursor: "pointer",
            fontSize: 13,
            lineHeight: 1,
          }}
        >
          ×
        </button>
      )}
    </div>
  );
}
