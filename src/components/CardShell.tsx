import { useEffect, useState, type ReactNode } from "react";
import type { AuthContext, Card, FrameworkConfig, StepKey } from "@shared/types";
import { canEdit, litCount } from "@shared/util";
import { C, inputStyle, mono, serif } from "../theme";
import { Mono, SectionLabel } from "./primitives";
import { Spine } from "./Spine";

/* 卡片外壳:标题 / 品类 / 可见性 / 槽位脊柱 / 搁置项。
   设计卡和拆解卡共用,右侧内容由 children 决定。 */

export function CardShell({
  card,
  fw,
  auth,
  currentStep,
  onStepFocus,
  onPatch,
  onBack,
  sidebarExtra,
  children,
}: {
  card: Card;
  fw: FrameworkConfig;
  auth: AuthContext;
  currentStep: StepKey | null;
  onStepFocus: (k: StepKey) => void;
  onPatch: (p: Partial<Card>) => void;
  onBack: () => void;
  sidebarExtra?: ReactNode;
  children: ReactNode;
}) {
  const writable = canEdit(card, auth.user.id, auth.role);
  const lit = litCount(card, fw);
  const staleFramework = card.frameworkVersion !== fw.version;
  const pending = card.pending.filter((p) => !p.resolved);

  const [name, setName] = useState(card.name);
  useEffect(() => setName(card.name), [card.name]);

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}>
      {/* 头 */}
      <div
        style={{
          display: "flex",
          alignItems: "flex-start",
          gap: 12,
          padding: "14px 0 12px",
          borderBottom: `1px solid ${C.edgeSoft}`,
        }}
      >
        <button
          onClick={onBack}
          style={{
            background: "none",
            border: "none",
            color: C.muted,
            cursor: "pointer",
            fontSize: 15,
            paddingTop: 3,
          }}
        >
          ←
        </button>

        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", gap: 9, alignItems: "baseline" }}>
            <Mono
              style={{
                fontSize: 9.5,
                color: card.type === "teardown" ? C.skeleton : C.dim,
                letterSpacing: "0.14em",
                flexShrink: 0,
              }}
            >
              {card.type === "teardown" ? "拆解卡" : "设计卡"}
            </Mono>
          </div>
          <input
            value={name}
            disabled={!writable}
            onChange={(e) => setName(e.target.value)}
            onBlur={() => name !== card.name && onPatch({ name })}
            placeholder="未命名"
            style={{
              background: "none",
              border: "none",
              outline: "none",
              color: C.bone,
              fontFamily: serif,
              fontSize: 23,
              width: "100%",
              padding: 0,
              marginTop: 2,
              letterSpacing: "0.01em",
            }}
          />

          <div
            style={{
              display: "flex",
              gap: 6,
              marginTop: 7,
              alignItems: "center",
              flexWrap: "wrap",
            }}
          >
            {fw.taxonomies.categories.map((c) => {
              const on = card.categories.includes(c.key);
              return (
                <button
                  key={c.key}
                  disabled={!writable}
                  onClick={() =>
                    onPatch({
                      categories: on
                        ? card.categories.filter((x) => x !== c.key)
                        : [...card.categories, c.key],
                    })
                  }
                  style={{
                    background: on ? "rgba(255,255,255,.05)" : "transparent",
                    border: `1px solid ${on ? c.color : C.edgeSoft}`,
                    color: on ? c.color : C.dim,
                    borderRadius: 2,
                    padding: "3px 9px",
                    fontSize: 11,
                    cursor: writable ? "pointer" : "default",
                  }}
                >
                  {c.label}
                </button>
              );
            })}

            <select
              value={card.visibility}
              disabled={!writable}
              onChange={(e) =>
                onPatch({ visibility: e.target.value as Card["visibility"] })
              }
              title="谁能看到这张卡"
              style={{
                ...inputStyle,
                width: "auto",
                padding: "3px 6px",
                fontSize: 11,
                fontFamily: mono,
                background: "transparent",
                color: C.muted,
              }}
            >
              <option value="private">私有</option>
              <option value="team_read">团队可见</option>
              <option value="team_edit">团队可编辑</option>
            </select>

            <Mono style={{ fontSize: 10, color: C.dim, marginLeft: 4 }}>
              {lit}/{fw.steps.length} 已确定
            </Mono>
          </div>
        </div>
      </div>

      {/* 框架版本不一致的提示(§6.2) */}
      {staleFramework && (
        <div
          style={{
            fontSize: 11.5,
            color: C.inferred,
            border: `1px solid ${C.inferred}`,
            borderRadius: 2,
            padding: "7px 11px",
            marginTop: 10,
            lineHeight: 1.6,
          }}
        >
          这张卡是按框架 v{card.frameworkVersion} 推演的,当前团队框架是 v{fw.version}。
          结论要按旧定义读;继续对话仍会用 v{card.frameworkVersion},不会中途换规则。
        </div>
      )}

      {/* 移动端顶部横条 */}
      <div
        className="fw-spine-h"
        style={{ padding: "10px 0", borderBottom: `1px solid ${C.edgeSoft}` }}
      >
        <Spine card={card} fw={fw} currentStep={currentStep} onJump={onStepFocus} horizontal />
      </div>

      <div style={{ display: "flex", gap: 24, flex: 1, minHeight: 0 }}>
        <div
          className="fw-spine-v"
          style={{ width: 216, flexShrink: 0, overflowY: "auto", paddingTop: 16 }}
        >
          <div style={{ paddingLeft: 10 }}>
            <SectionLabel>{fw.steps.length} 个槽 / SLOTS</SectionLabel>
          </div>
          <div style={{ marginTop: 10 }}>
            <Spine card={card} fw={fw} currentStep={currentStep} onJump={onStepFocus} />
          </div>

          {pending.length > 0 && (
            <div style={{ marginTop: 22, paddingLeft: 10 }}>
              <SectionLabel color={C.danger}>搁置项 / {pending.length}</SectionLabel>
              <div
                style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 6 }}
              >
                {pending.map((p) => (
                  <div
                    key={p.id}
                    style={{
                      fontSize: 11,
                      color: C.muted,
                      lineHeight: 1.6,
                      borderLeft: `1px solid ${C.edge}`,
                      paddingLeft: 8,
                      display: "flex",
                      gap: 6,
                    }}
                  >
                    <span style={{ flex: 1 }}>{p.text}</span>
                    {writable && (
                      <button
                        title="标记为已解决"
                        onClick={() =>
                          onPatch({
                            pending: card.pending.map((x) =>
                              x.id === p.id ? { ...x, resolved: true } : x,
                            ),
                          })
                        }
                        style={{
                          background: "none",
                          border: "none",
                          color: C.dim,
                          cursor: "pointer",
                          fontSize: 12,
                        }}
                      >
                        ✓
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {sidebarExtra && (
            <div
              style={{
                marginTop: 24,
                paddingLeft: 10,
                display: "flex",
                flexDirection: "column",
                gap: 7,
              }}
            >
              {sidebarExtra}
            </div>
          )}
        </div>

        {children}
      </div>
    </div>
  );
}
