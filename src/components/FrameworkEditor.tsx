import { useEffect, useState } from "react";
import type { AuthContext, FrameworkConfig, StepDef } from "@shared/types";
import { uid } from "@shared/util";
import * as api from "../api";
import { C, inputStyle, mono } from "../theme";
import { Btn, ErrorBar, Modal, Mono, SectionLabel } from "./primitives";

/* ============================================================
   框架编辑界面(§6.1 / §6.2)
   ------------------------------------------------------------
   三类变更,成本递增,这个界面把前两类做成零代码:
   - 改定义、加规则 → 直接改文本框
   - 增删步骤     → 加/删一张步骤卡,界面按数组长度自适应
   - 改框架结构   → 走底部的 JSON 直编(罕见,但不锁死)

   每次保存产生一个新版本号,旧卡片仍指向它当初用的版本。
   ============================================================ */

export function FrameworkEditor({
  fw,
  auth,
  onClose,
  onSaved,
}: {
  fw: FrameworkConfig;
  auth: AuthContext;
  onClose: () => void;
  onSaved: (next: FrameworkConfig) => void;
}) {
  const [draft, setDraft] = useState<FrameworkConfig>(() => structuredClone(fw));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [versions, setVersions] = useState<api.FrameworkVersionRow[]>([]);
  const [rawMode, setRawMode] = useState(false);
  const [raw, setRaw] = useState("");

  const canEdit = auth.role === "admin" || auth.role === "editor";

  useEffect(() => {
    void api.getFrameworkVersions().then(setVersions).catch(() => {});
  }, []);

  const set = <K extends keyof FrameworkConfig>(k: K, v: FrameworkConfig[K]) =>
    setDraft((d) => ({ ...d, [k]: v }));

  const setStep = (i: number, patch: Partial<StepDef>) =>
    setDraft((d) => ({
      ...d,
      steps: d.steps.map((s, j) => (j === i ? { ...s, ...patch } : s)),
    }));

  const addStep = () =>
    setDraft((d) => ({
      ...d,
      steps: [
        ...d.steps,
        {
          key: `step_${uid().slice(0, 5)}`,
          order: d.steps.length + 1,
          name: "新步骤",
          hint: "",
          aiRole: "",
          checks: [],
        },
      ],
    }));

  const removeStep = (i: number) =>
    setDraft((d) => ({
      ...d,
      steps: d.steps.filter((_, j) => j !== i).map((s, j) => ({ ...s, order: j + 1 })),
    }));

  const moveStep = (i: number, dir: -1 | 1) =>
    setDraft((d) => {
      const next = [...d.steps];
      const j = i + dir;
      if (j < 0 || j >= next.length) return d;
      [next[i], next[j]] = [next[j], next[i]];
      return { ...d, steps: next.map((s, k) => ({ ...s, order: k + 1 })) };
    });

  const save = async () => {
    setBusy(true);
    setErr("");
    try {
      let payload = draft;
      if (rawMode) {
        payload = JSON.parse(raw) as FrameworkConfig;
      }
      const saved = await api.saveFramework(payload);
      onSaved(saved);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "保存失败");
      setBusy(false);
    }
  };

  return (
    <Modal onClose={onClose} title={`框架配置 · 当前 v${fw.version}`} wide>
      {err && (
        <div style={{ marginBottom: 14 }}>
          <ErrorBar text={err} onClose={() => setErr("")} />
        </div>
      )}

      {!canEdit && (
        <div style={{ marginBottom: 14 }}>
          <ErrorBar text="你是 viewer,只能查看框架,不能修改。框架是团队级共享资源。" />
        </div>
      )}

      <div style={{ fontSize: 11.5, color: C.dim, lineHeight: 1.8, marginBottom: 20 }}>
        这里的每一个字都会拼进推演引擎的系统提示。改完保存会生成一个新版本;
        已有卡片继续用它们各自的版本,不会中途换规则。
      </div>

      {rawMode ? (
        <>
          <SectionLabel>JSON 直编</SectionLabel>
          <textarea
            value={raw}
            onChange={(e) => setRaw(e.target.value)}
            spellCheck={false}
            rows={26}
            style={{
              ...inputStyle,
              marginTop: 8,
              fontFamily: mono,
              fontSize: 11.5,
              lineHeight: 1.65,
              resize: "vertical",
            }}
          />
        </>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 26 }}>
          {/* 版本说明 */}
          <Field
            label="这次改动的说明"
            value={draft.label}
            onChange={(v) => set("label", v)}
            disabled={!canEdit}
            placeholder="如「补了温度曲线的校验」"
          />

          {/* 引擎身份 */}
          <div>
            <SectionLabel>引擎身份</SectionLabel>
            <div style={{ marginTop: 9, display: "flex", flexDirection: "column", gap: 9 }}>
              <Field
                label="名称"
                value={draft.identity.title}
                onChange={(v) => set("identity", { ...draft.identity, title: v })}
                disabled={!canEdit}
              />
              <Field
                label="任务声明"
                value={draft.identity.mission}
                onChange={(v) => set("identity", { ...draft.identity, mission: v })}
                disabled={!canEdit}
                rows={2}
              />
              <Field
                label="流程原则"
                value={draft.flowPrinciple}
                onChange={(v) => set("flowPrinciple", v)}
                disabled={!canEdit}
                rows={3}
              />
            </div>
          </div>

          {/* 步骤 —— 数量可变 */}
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <SectionLabel>步骤 / {draft.steps.length} 步</SectionLabel>
              <div style={{ flex: 1 }} />
              {canEdit && (
                <Btn onClick={addStep} tone="ghost">
                  + 加一步
                </Btn>
              )}
            </div>
            <div
              style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 12 }}
            >
              {draft.steps.map((s, i) => (
                <div
                  key={i}
                  style={{
                    border: `1px solid ${C.edgeSoft}`,
                    borderRadius: 2,
                    padding: "12px 13px",
                    background: C.surface,
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      gap: 8,
                      alignItems: "center",
                      marginBottom: 10,
                    }}
                  >
                    <Mono style={{ fontSize: 11, color: C.muted }}>
                      {String(i + 1).padStart(2, "0")}
                    </Mono>
                    <input
                      value={s.name}
                      disabled={!canEdit}
                      onChange={(e) => setStep(i, { name: e.target.value })}
                      placeholder="步骤名称"
                      style={{ ...inputStyle, flex: 1, background: C.ink }}
                    />
                    <input
                      value={s.key}
                      disabled={!canEdit}
                      onChange={(e) => setStep(i, { key: e.target.value })}
                      placeholder="key"
                      title="步骤 key。已有卡片按 key 匹配结论,改 key 等于新增一步。"
                      style={{
                        ...inputStyle,
                        width: 130,
                        background: C.ink,
                        fontFamily: mono,
                        fontSize: 11.5,
                      }}
                    />
                    {canEdit && (
                      <>
                        <IconBtn onClick={() => moveStep(i, -1)} disabled={i === 0}>
                          ↑
                        </IconBtn>
                        <IconBtn
                          onClick={() => moveStep(i, 1)}
                          disabled={i === draft.steps.length - 1}
                        >
                          ↓
                        </IconBtn>
                        <IconBtn onClick={() => removeStep(i)} danger>
                          ×
                        </IconBtn>
                      </>
                    )}
                  </div>

                  <Field
                    label="引导语(空槽时显示给用户)"
                    value={s.hint}
                    onChange={(v) => setStep(i, { hint: v })}
                    disabled={!canEdit}
                  />
                  <div style={{ height: 8 }} />
                  <Field
                    label="AI 在这一步的职责"
                    value={s.aiRole}
                    onChange={(v) => setStep(i, { aiRole: v })}
                    disabled={!canEdit}
                    rows={2}
                  />
                  <div style={{ height: 8 }} />
                  <Field
                    label="校验规则(一行一条,有顺序)"
                    value={s.checks.join("\n")}
                    onChange={(v) =>
                      setStep(i, { checks: v.split("\n").filter((x) => x.trim()) })
                    }
                    disabled={!canEdit}
                    rows={3}
                    mono
                  />
                  <div style={{ height: 8 }} />
                  <Field
                    label="收尾条件"
                    value={s.exitCriterion ?? ""}
                    onChange={(v) => setStep(i, { exitCriterion: v })}
                    disabled={!canEdit}
                  />
                </div>
              ))}
            </div>
          </div>

          {/* 知识段落 */}
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <SectionLabel>领域知识 / {draft.sections.length} 段</SectionLabel>
              <div style={{ flex: 1 }} />
              {canEdit && (
                <Btn
                  onClick={() =>
                    set("sections", [
                      ...draft.sections,
                      {
                        id: uid(),
                        title: "新段落",
                        body: "",
                        order: draft.sections.length + 1,
                      },
                    ])
                  }
                >
                  + 加一段
                </Btn>
              )}
            </div>
            <div
              style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 12 }}
            >
              {draft.sections.map((sec, i) => (
                <div
                  key={sec.id}
                  style={{
                    border: `1px solid ${C.edgeSoft}`,
                    borderRadius: 2,
                    padding: "12px 13px",
                    background: C.surface,
                  }}
                >
                  <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
                    <input
                      value={sec.title}
                      disabled={!canEdit}
                      onChange={(e) =>
                        set(
                          "sections",
                          draft.sections.map((x, j) =>
                            j === i ? { ...x, title: e.target.value } : x,
                          ),
                        )
                      }
                      style={{ ...inputStyle, flex: 1, background: C.ink }}
                    />
                    {canEdit && (
                      <IconBtn
                        onClick={() =>
                          set(
                            "sections",
                            draft.sections.filter((_, j) => j !== i),
                          )
                        }
                        danger
                      >
                        ×
                      </IconBtn>
                    )}
                  </div>
                  <textarea
                    value={sec.body}
                    disabled={!canEdit}
                    onChange={(e) =>
                      set(
                        "sections",
                        draft.sections.map((x, j) =>
                          j === i ? { ...x, body: e.target.value } : x,
                        ),
                      )
                    }
                    rows={6}
                    style={{
                      ...inputStyle,
                      background: C.ink,
                      lineHeight: 1.7,
                      resize: "vertical",
                    }}
                  />
                </div>
              ))}
            </div>
          </div>

          {/* 行为规则 */}
          <div>
            <SectionLabel>行为规则</SectionLabel>
            <div style={{ marginTop: 9, display: "flex", flexDirection: "column", gap: 9 }}>
              <Field
                label="每轮必须覆盖的事(一行一条)"
                value={draft.behavior.turnContract.join("\n")}
                onChange={(v) =>
                  set("behavior", {
                    ...draft.behavior,
                    turnContract: v.split("\n").filter((x) => x.trim()),
                  })
                }
                disabled={!canEdit}
                rows={3}
                mono
              />
              <Field
                label="明令禁止(一行一条)"
                value={draft.behavior.forbidden.join("\n")}
                onChange={(v) =>
                  set("behavior", {
                    ...draft.behavior,
                    forbidden: v.split("\n").filter((x) => x.trim()),
                  })
                }
                disabled={!canEdit}
                rows={3}
                mono
              />
              <Field
                label="发散边界(一行一条)"
                value={draft.behavior.divergence.join("\n")}
                onChange={(v) =>
                  set("behavior", {
                    ...draft.behavior,
                    divergence: v.split("\n").filter((x) => x.trim()),
                  })
                }
                disabled={!canEdit}
                rows={3}
                mono
              />
              <Field
                label="起步处理(一行一条)"
                value={draft.behavior.startup.join("\n")}
                onChange={(v) =>
                  set("behavior", {
                    ...draft.behavior,
                    startup: v.split("\n").filter((x) => x.trim()),
                  })
                }
                disabled={!canEdit}
                rows={4}
                mono
              />
              <Field
                label="封步话术"
                value={draft.behavior.sealingTemplate}
                onChange={(v) =>
                  set("behavior", { ...draft.behavior, sealingTemplate: v })
                }
                disabled={!canEdit}
                rows={2}
              />
              <Field
                label="语气"
                value={draft.behavior.tone}
                onChange={(v) => set("behavior", { ...draft.behavior, tone: v })}
                disabled={!canEdit}
                rows={2}
              />
            </div>
          </div>

          {/* 词表与检索 */}
          <div>
            <SectionLabel>词表与检索</SectionLabel>
            <div style={{ marginTop: 9, display: "flex", flexDirection: "column", gap: 9 }}>
              <Field
                label="功能位词表(一行一个)"
                value={draft.taxonomies.functionSlots.join("\n")}
                onChange={(v) =>
                  set("taxonomies", {
                    ...draft.taxonomies,
                    functionSlots: v.split("\n").filter((x) => x.trim()),
                  })
                }
                disabled={!canEdit}
                rows={4}
                mono
              />
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                <NumField
                  label="相关度取前 N"
                  value={draft.retrieval.relevanceTopK}
                  onChange={(n) =>
                    set("retrieval", { ...draft.retrieval, relevanceTopK: n })
                  }
                  disabled={!canEdit}
                />
                <NumField
                  label="相关度阈值"
                  value={draft.retrieval.minRelevanceScore}
                  onChange={(n) =>
                    set("retrieval", { ...draft.retrieval, minRelevanceScore: n })
                  }
                  disabled={!canEdit}
                />
                <NumField
                  label="单条注入截断"
                  value={draft.retrieval.maxItemChars}
                  onChange={(n) =>
                    set("retrieval", { ...draft.retrieval, maxItemChars: n })
                  }
                  disabled={!canEdit}
                />
              </div>
              <div style={{ fontSize: 11, color: C.dim, lineHeight: 1.7 }}>
                参考库类型:
                {draft.taxonomies.libraryTypes
                  .map((t) => `${t.label}(${t.retrieval === "always" ? "每轮必检" : t.retrieval === "ingredient" ? "按原料名" : "按相关度"})`)
                  .join(" · ")}
                。要增删类型或改调用策略,用底部的 JSON 直编。
              </div>
            </div>
          </div>

          {/* 拆解 */}
          <div>
            <SectionLabel>拆解模式</SectionLabel>
            <div style={{ marginTop: 9 }}>
              <Field
                label="confirmed / inferred 的约束说明"
                value={draft.teardown.confidenceNote}
                onChange={(v) =>
                  set("teardown", { ...draft.teardown, confidenceNote: v })
                }
                disabled={!canEdit}
                rows={4}
              />
            </div>
          </div>

          {/* 版本历史 */}
          {versions.length > 0 && (
            <div>
              <SectionLabel>版本历史</SectionLabel>
              <div
                style={{ marginTop: 9, display: "flex", flexDirection: "column", gap: 5 }}
              >
                {versions.map((v) => (
                  <div
                    key={v.version}
                    style={{
                      display: "flex",
                      gap: 10,
                      fontSize: 11.5,
                      color: v.version === fw.version ? C.bone : C.muted,
                      borderLeft: `1px solid ${v.version === fw.version ? C.tea : C.edge}`,
                      paddingLeft: 9,
                    }}
                  >
                    <Mono style={{ fontSize: 11 }}>v{v.version}</Mono>
                    <span style={{ flex: 1 }}>{v.label}</span>
                    <Mono style={{ fontSize: 10, color: C.dim }}>{v.stepCount} 步</Mono>
                    <Mono style={{ fontSize: 10, color: C.dim }}>
                      {new Date(v.updatedAt).toLocaleDateString("zh-CN")}
                    </Mono>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      <div
        style={{
          marginTop: 24,
          display: "flex",
          gap: 8,
          alignItems: "center",
          flexWrap: "wrap",
          position: "sticky",
          bottom: -24,
          background: C.surface,
          paddingTop: 12,
          paddingBottom: 4,
          borderTop: `1px solid ${C.edgeSoft}`,
        }}
      >
        <Btn tone="solid" onClick={() => void save()} disabled={busy || !canEdit}>
          {busy ? "保存中…" : `保存为 v${Number(fw.version) + 1}`}
        </Btn>
        <Btn onClick={onClose}>取消</Btn>
        <div style={{ flex: 1 }} />
        <Btn
          onClick={() => {
            if (!rawMode) setRaw(JSON.stringify(draft, null, 2));
            else {
              try {
                setDraft(JSON.parse(raw) as FrameworkConfig);
              } catch {
                setErr("JSON 解析失败,先修好再切回表单");
                return;
              }
            }
            setRawMode(!rawMode);
          }}
        >
          {rawMode ? "回到表单" : "JSON 直编"}
        </Btn>
      </div>
    </Modal>
  );
}

function Field({
  label,
  value,
  onChange,
  disabled,
  rows,
  placeholder,
  mono: isMono,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
  rows?: number;
  placeholder?: string;
  mono?: boolean;
}) {
  return (
    <div>
      <Mono style={{ fontSize: 10, color: C.dim, letterSpacing: "0.08em" }}>{label}</Mono>
      {rows && rows > 1 ? (
        <textarea
          value={value}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
          rows={rows}
          placeholder={placeholder}
          style={{
            ...inputStyle,
            marginTop: 5,
            lineHeight: 1.7,
            resize: "vertical",
            fontFamily: isMono ? mono : "inherit",
            fontSize: isMono ? 11.5 : 13,
          }}
        />
      ) : (
        <input
          value={value}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          style={{ ...inputStyle, marginTop: 5 }}
        />
      )}
    </div>
  );
}

function NumField({
  label,
  value,
  onChange,
  disabled,
}: {
  label: string;
  value: number;
  onChange: (n: number) => void;
  disabled?: boolean;
}) {
  return (
    <div>
      <Mono style={{ fontSize: 10, color: C.dim, letterSpacing: "0.08em" }}>{label}</Mono>
      <input
        type="number"
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(Number(e.target.value))}
        style={{ ...inputStyle, marginTop: 5, width: 120 }}
      />
    </div>
  );
}

function IconBtn({
  children,
  onClick,
  disabled,
  danger,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        background: "none",
        border: `1px solid ${danger ? C.danger : C.edgeSoft}`,
        color: danger ? C.danger : C.muted,
        borderRadius: 2,
        width: 28,
        height: 30,
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.35 : 1,
        fontSize: 12,
        flexShrink: 0,
      }}
    >
      {children}
    </button>
  );
}
