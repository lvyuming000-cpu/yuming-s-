import type { Card, FrameworkConfig, StepKey } from "@shared/types";
import { accentColor, alignSteps, sortedSteps } from "@shared/util";
import { C } from "../theme";
import { Mono } from "./primitives";

/* ============================================================
   槽位脊柱
   ------------------------------------------------------------
   槽的数量、名称、引导语全部来自框架配置。界面按数组长度渲染,
   没有硬编码的 6 —— 框架加到七步,这里自动多一格(§6.1)。

   空槽始终可见,不允许假装完成(§2.2)。
   ============================================================ */

export function Spine({
  card,
  fw,
  currentStep,
  onJump,
  horizontal,
}: {
  card: Card;
  fw: FrameworkConfig;
  currentStep: StepKey | null;
  onJump?: (key: StepKey) => void;
  horizontal?: boolean;
}) {
  const accent = accentColor(card, fw);
  const rows = alignSteps(card, fw);
  const names = new Map(fw.steps.map((s) => [s.key, s] as const));
  const total = Math.max(rows.length - 1, 1);

  return (
    <div
      style={{
        display: "flex",
        flexDirection: horizontal ? "row" : "column",
        gap: horizontal ? 6 : 2,
        overflowX: horizontal ? "auto" : "visible",
        padding: horizontal ? "2px 0" : 0,
      }}
    >
      {rows.map((row, i) => {
        const def = names.get(row.key);
        const isCur = currentStep === row.key;
        const done = row.state.state === "confirmed";
        const disc = row.state.state === "discussing";
        const col = done ? accent : disc ? C.bone : C.dim;
        // 重量轴:越往后越「重」
        const weight = 0.28 + (i / total) * 0.72;
        const order = def?.order ?? i + 1;

        return (
          <div
            key={row.key}
            onClick={() => onJump?.(row.key)}
            style={{
              display: "flex",
              alignItems: horizontal ? "center" : "flex-start",
              gap: 9,
              padding: horizontal ? "7px 11px" : "9px 10px",
              whiteSpace: horizontal ? "nowrap" : "normal",
              background: isCur ? C.raised : "transparent",
              borderLeft: horizontal
                ? "none"
                : `2px solid ${done ? accent : disc ? C.edge : "transparent"}`,
              border: horizontal
                ? `1px solid ${isCur ? C.edge : C.edgeSoft}`
                : undefined,
              borderRadius: horizontal ? 2 : 0,
              cursor: onJump ? "pointer" : "default",
              transition: "all .18s",
              opacity: row.orphaned ? 0.55 : 1,
            }}
          >
            <div style={{ position: "relative", flexShrink: 0 }}>
              <Mono
                style={{ fontSize: 11, color: col, opacity: done || disc ? 1 : 0.5 }}
              >
                {row.orphaned ? "──" : String(order).padStart(2, "0")}
              </Mono>
              {!horizontal && !row.orphaned && (
                <div
                  style={{
                    position: "absolute",
                    left: -10,
                    top: 4,
                    width: 3,
                    height: 3 + weight * 9,
                    background: done ? accent : C.edge,
                    opacity: done ? 0.9 : 0.4,
                  }}
                />
              )}
            </div>

            <div style={{ minWidth: 0, flex: 1 }}>
              <div
                style={{
                  fontSize: 12.5,
                  color: done || disc ? C.bone : C.muted,
                  opacity: done || disc ? 1 : 0.65,
                  letterSpacing: "0.02em",
                }}
              >
                {def?.name ?? row.key}
                {row.orphaned && (
                  <Mono style={{ fontSize: 9.5, color: C.dim, marginLeft: 6 }}>
                    已从框架移除
                  </Mono>
                )}
              </div>

              {!horizontal && done && row.state.conclusion && (
                <div
                  style={{
                    fontSize: 11,
                    color: C.muted,
                    marginTop: 3,
                    lineHeight: 1.55,
                    display: "-webkit-box",
                    WebkitLineClamp: 3,
                    WebkitBoxOrient: "vertical",
                    overflow: "hidden",
                  }}
                >
                  {row.state.conclusion}
                </div>
              )}
              {!horizontal && !done && (
                <div
                  style={{ fontSize: 10.5, color: C.dim, marginTop: 2, lineHeight: 1.5 }}
                >
                  {disc ? "讨论中" : (def?.hint ?? "")}
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** 卡片墙上的紧凑进度条 —— 同样按配置的步数渲染 */
export function SlotBar({ card, fw }: { card: Card; fw: FrameworkConfig }) {
  const accent = accentColor(card, fw);
  const steps = sortedSteps(fw);
  return (
    <div style={{ display: "flex", gap: 3 }}>
      {steps.map((s) => {
        const st = card.steps[s.key]?.state ?? "empty";
        return (
          <div
            key={s.key}
            title={s.name}
            style={{
              width: 15,
              height: 3,
              background:
                st === "confirmed" ? accent : st === "discussing" ? C.edge : C.edgeSoft,
            }}
          />
        );
      })}
    </div>
  );
}
