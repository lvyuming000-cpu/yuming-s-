import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createServerSttProvider, mediaRecorderAvailable } from "./serverStt";
import type { ProviderAvailability, ProviderId, VoiceProvider, VoiceState } from "./types";
import { createWebSpeechProvider, webSpeechAvailable } from "./webspeech";

/* ============================================================
   语音输入 hook
   ------------------------------------------------------------
   关键设计:这个 hook 不持有正文。它只把识别出来的文字通过
   onFinal 交给调用方,由调用方写进一个可编辑的 textarea。

   这样「转写结果可编辑再发送」是结构上保证的,不是靠自觉 ——
   没有任何一条路径能让语音直接触发发送。
   ============================================================ */

const PREF_KEY = "fw:voiceProvider";

export interface UseVoiceInput {
  providers: ProviderAvailability[];
  provider: ProviderId;
  setProvider: (id: ProviderId) => void;
  state: VoiceState;
  /** 说话中尚未定稿的文字,仅用于回显 */
  interim: string;
  error: string | null;
  clearError: () => void;
  /** 当前 provider 是否可用 */
  usable: boolean;
  unavailableReason?: string;
  toggle: () => void;
  stop: () => void;
  /** 录音已进行的秒数,server provider 没有实时文字时用它给反馈 */
  elapsed: number;
}

export function useVoiceInput(opts: {
  onFinal: (text: string) => void;
  serverSttEnabled: boolean;
}): UseVoiceInput {
  const { onFinal, serverSttEnabled } = opts;

  const [state, setState] = useState<VoiceState>("idle");
  const [interim, setInterim] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);

  const web = useMemo(() => webSpeechAvailable(), []);
  const rec = useMemo(() => mediaRecorderAvailable(), []);

  const providers = useMemo<ProviderAvailability[]>(
    () => [
      {
        id: "webspeech",
        label: "浏览器识别",
        available: web.available,
        reason: web.reason,
        realtime: true,
      },
      {
        id: "server",
        label: "高精度转写",
        available: serverSttEnabled && rec.available,
        reason: !serverSttEnabled
          ? "服务端没有配置转写服务"
          : rec.reason,
        realtime: false,
      },
    ],
    [web, rec, serverSttEnabled],
  );

  const [provider, setProviderState] = useState<ProviderId>(() => {
    const saved = localStorage.getItem(PREF_KEY) as ProviderId | null;
    if (saved === "webspeech" || saved === "server") return saved;
    // 有高精度就默认高精度 —— 中文风味术语的准确率差得明显
    return serverSttEnabled && rec.available ? "server" : "webspeech";
  });

  const instance = useRef<VoiceProvider | null>(null);
  const onFinalRef = useRef(onFinal);
  onFinalRef.current = onFinal;

  const current = providers.find((p) => p.id === provider);
  const usable = Boolean(current?.available);

  const stop = useCallback(() => {
    instance.current?.stop();
    instance.current = null;
  }, []);

  const setProvider = useCallback(
    (id: ProviderId) => {
      stop();
      setProviderState(id);
      localStorage.setItem(PREF_KEY, id);
      setError(null);
    },
    [stop],
  );

  const start = useCallback(() => {
    if (!usable) {
      setError(current?.reason ?? "当前语音方式不可用");
      return;
    }
    setError(null);
    setInterim("");
    const p =
      provider === "server" ? createServerSttProvider() : createWebSpeechProvider();
    instance.current = p;
    void p.start({
      onFinal: (t) => onFinalRef.current(t),
      onInterim: setInterim,
      onError: (m) => setError(m),
      onStateChange: setState,
    });
  }, [provider, usable, current]);

  const toggle = useCallback(() => {
    if (state === "idle") start();
    else stop();
  }, [state, start, stop]);

  // 录音计时 —— server provider 没有实时文字,用时长给「工具在听」的反馈
  useEffect(() => {
    if (state !== "listening") {
      setElapsed(0);
      return;
    }
    const t0 = Date.now();
    const timer = window.setInterval(
      () => setElapsed(Math.floor((Date.now() - t0) / 1000)),
      500,
    );
    return () => clearInterval(timer);
  }, [state]);

  // 组件卸载时确保麦克风被释放
  useEffect(() => () => instance.current?.stop(), []);

  return {
    providers,
    provider,
    setProvider,
    state,
    interim,
    error,
    clearError: () => setError(null),
    usable,
    unavailableReason: current?.reason,
    toggle,
    stop,
    elapsed,
  };
}
