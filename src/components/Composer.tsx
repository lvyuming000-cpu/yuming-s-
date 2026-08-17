import { useEffect, useRef, useState } from "react";
import type { InputMode } from "@shared/types";
import { C, inputStyle, mono } from "../theme";
import { useVoiceInput } from "../voice/useVoiceInput";
import type { ProviderId } from "../voice/types";
import { Btn, ErrorBar, Mono } from "./primitives";

/* ============================================================
   语音 / 文字复合输入框
   ------------------------------------------------------------
   三个入口共用这一个组件(§6.3):
   1. 首页 —— 说一个起点,开一张新卡
   2. 卡片内 —— 对话中的每一轮
   3. 拆解卡的「感受」栏

   两条硬规则:
   - 语音只往草稿里写字,永远不触发发送。识别错了就改,不用重说。
   - 文字输入是一等入口,不是降级方案:同一个框、同一个发送键、
     同样的快捷键。办公室里不方便说话时体验不打折。
   ============================================================ */

export interface ComposerProps {
  value: string;
  onChange: (v: string) => void;
  /** 返回 true 表示已发送(用于清空);不传则不显示发送键(受控嵌入场景) */
  onSubmit?: (text: string, inputMode: InputMode) => void | Promise<void>;
  placeholder?: string;
  submitLabel?: string;
  busy?: boolean;
  disabled?: boolean;
  serverSttEnabled: boolean;
  rows?: number;
  minHeight?: number;
  /** 无发送键时用于向外汇报输入来源 */
  onInputModeChange?: (mode: InputMode) => void;
  autoFocus?: boolean;
}

export function Composer({
  value,
  onChange,
  onSubmit,
  placeholder = "说点什么 — 语音或打字都行",
  submitLabel = "发送",
  busy,
  disabled,
  serverSttEnabled,
  rows = 1,
  minHeight = 38,
  onInputModeChange,
  autoFocus,
}: ComposerProps) {
  // 只要这次内容里掺过语音,就整条标记为 voice
  const [touchedByVoice, setTouchedByVoice] = useState(false);
  const taRef = useRef<HTMLTextAreaElement>(null);

  const voice = useVoiceInput({
    serverSttEnabled,
    onFinal: (text) => {
      setTouchedByVoice(true);
      onInputModeChange?.("voice");
      // 追加进草稿,自己补一个空格,不动用户已经打好的字
      onChange(joinTranscript(value, text));
      requestAnimationFrame(() => {
        const el = taRef.current;
        if (el) {
          el.focus();
          el.selectionStart = el.selectionEnd = el.value.length;
        }
      });
    },
  });

  // 自适应高度
  useEffect(() => {
    const el = taRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }, [value]);

  const submit = async () => {
    const text = value.trim();
    if (!text || busy || disabled || !onSubmit) return;
    voice.stop();
    const mode: InputMode = touchedByVoice ? "voice" : "text";
    await onSubmit(text, mode);
    setTouchedByVoice(false);
  };

  const listening = voice.state === "listening";
  const transcribing = voice.state === "transcribing";
  const activeProvider = voice.providers.find((p) => p.id === voice.provider);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {voice.error && <ErrorBar text={voice.error} onClose={voice.clearError} />}

      <div style={{ display: "flex", gap: 9, alignItems: "flex-end" }}>
        <MicButton
          state={voice.state}
          usable={voice.usable}
          title={
            !voice.usable
              ? (voice.unavailableReason ?? "语音不可用,请用打字")
              : listening
                ? "停止"
                : `语音输入(${activeProvider?.label ?? ""})`
          }
          onClick={voice.toggle}
        />

        <div style={{ flex: 1, minWidth: 0 }}>
          <textarea
            ref={taRef}
            value={value}
            autoFocus={autoFocus}
            onChange={(e) => {
              onChange(e.target.value);
              if (!e.target.value.trim()) setTouchedByVoice(false);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                void submit();
              }
            }}
            placeholder={placeholder}
            rows={rows}
            disabled={disabled}
            style={{
              ...inputStyle,
              background: C.surface,
              resize: "none",
              minHeight,
              maxHeight: 200,
              lineHeight: 1.75,
              opacity: disabled ? 0.5 : 1,
            }}
          />
          {/* 实时转写回显:说话时能看到文字出现 */}
          {listening && voice.interim && (
            <div
              style={{
                fontSize: 12.5,
                color: C.dim,
                fontStyle: "italic",
                padding: "5px 11px 0",
                lineHeight: 1.6,
              }}
            >
              {voice.interim}…
            </div>
          )}
          {listening && !voice.interim && (
            <div
              style={{
                fontFamily: mono,
                fontSize: 10.5,
                color: C.danger,
                padding: "5px 11px 0",
                letterSpacing: "0.08em",
              }}
            >
              {activeProvider?.realtime
                ? "在听…(说完按停止)"
                : `录音中 ${String(Math.floor(voice.elapsed / 60)).padStart(2, "0")}:${String(voice.elapsed % 60).padStart(2, "0")} — 按停止后转写`}
            </div>
          )}
          {transcribing && (
            <div
              style={{
                fontFamily: mono,
                fontSize: 10.5,
                color: C.muted,
                padding: "5px 11px 0",
                letterSpacing: "0.08em",
              }}
            >
              转写中…
            </div>
          )}
        </div>

        {onSubmit && (
          <Btn
            onClick={() => void submit()}
            disabled={busy || disabled || !value.trim()}
            tone="solid"
            style={{ height: minHeight }}
          >
            {busy ? "…" : submitLabel}
          </Btn>
        )}
      </div>

      <ProviderPicker
        providers={voice.providers}
        current={voice.provider}
        onPick={voice.setProvider}
      />
    </div>
  );
}

function joinTranscript(existing: string, incoming: string): string {
  const add = incoming.trim();
  if (!add) return existing;
  if (!existing) return add;
  const needsSpace = !/[\s\n]$/.test(existing) && !/^[,。!?、;:]/.test(add);
  return existing + (needsSpace ? " " : "") + add;
}

function MicButton({
  state,
  usable,
  title,
  onClick,
}: {
  state: "idle" | "listening" | "transcribing";
  usable: boolean;
  title: string;
  onClick: () => void;
}) {
  const listening = state === "listening";
  const busy = state === "transcribing";
  return (
    <button
      onClick={onClick}
      title={title}
      aria-label={title}
      disabled={!usable || busy}
      style={{
        width: 38,
        height: 38,
        flexShrink: 0,
        borderRadius: "50%",
        border: `1px solid ${listening ? C.danger : usable ? C.edge : C.edgeSoft}`,
        background: listening ? "rgba(217,106,92,.12)" : "transparent",
        color: !usable ? C.dim : listening ? C.danger : busy ? C.muted : C.muted,
        cursor: usable && !busy ? "pointer" : "not-allowed",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: 14,
        transition: "all .2s",
        animation: listening ? "fw-pulse 1.4s ease-in-out infinite" : undefined,
      }}
    >
      {listening ? "■" : busy ? "⋯" : "◉"}
    </button>
  );
}

function ProviderPicker({
  providers,
  current,
  onPick,
}: {
  providers: ReturnType<typeof useVoiceInput>["providers"];
  current: ProviderId;
  onPick: (id: ProviderId) => void;
}) {
  const anyAvailable = providers.some((p) => p.available);
  if (!anyAvailable) {
    const reason = providers.find((p) => p.reason)?.reason;
    return (
      <Mono style={{ fontSize: 10, color: C.dim, letterSpacing: "0.06em" }}>
        语音不可用{reason ? `(${reason})` : ""} — 打字同样好用
      </Mono>
    );
  }
  const usable = providers.filter((p) => p.available);
  if (usable.length < 2) return null;

  return (
    <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
      <Mono style={{ fontSize: 10, color: C.dim, letterSpacing: "0.1em" }}>语音方式</Mono>
      {usable.map((p) => (
        <button
          key={p.id}
          onClick={() => onPick(p.id)}
          title={p.realtime ? "说话时逐字显示" : "录完统一转写,中文术语更准"}
          style={{
            background: current === p.id ? "rgba(255,255,255,.05)" : "transparent",
            border: `1px solid ${current === p.id ? C.edge : C.edgeSoft}`,
            color: current === p.id ? C.bone : C.dim,
            borderRadius: 2,
            padding: "2px 8px",
            fontSize: 10.5,
            fontFamily: mono,
            cursor: "pointer",
          }}
        >
          {p.label}
        </button>
      ))}
    </div>
  );
}
