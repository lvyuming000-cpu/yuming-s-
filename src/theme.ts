/* 视觉语言沿用原型:暗底、骨色文字、等宽标注、锐角边框。 */

export const C = {
  ink: "#17141A",
  surface: "#201C24",
  raised: "#2A252E",
  edge: "#3B3441",
  edgeSoft: "#302A36",
  bone: "#EDE7DE",
  muted: "#948B98",
  dim: "#6E6675",
  tea: "#C9D94F",
  alcohol: "#DE9A55",
  danger: "#D96A5C",
  skeleton: "#7E8AA8",
  inferred: "#B98BD9",
  confirmed: "#8FBF9F",
} as const;

export const serif = "'Instrument Serif', Georgia, serif";
export const mono = "'IBM Plex Mono', ui-monospace, monospace";
export const sans =
  "-apple-system, BlinkMacSystemFont, 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', system-ui, sans-serif";

export const inputStyle: React.CSSProperties = {
  width: "100%",
  boxSizing: "border-box",
  background: C.ink,
  border: `1px solid ${C.edgeSoft}`,
  borderRadius: 2,
  color: C.bone,
  padding: "9px 11px",
  fontSize: 13,
  outline: "none",
  fontFamily: "inherit",
};
