import type { VoiceCallbacks, VoiceProvider } from "./types";

/* ============================================================
   浏览器原生语音识别(Web Speech API)
   ------------------------------------------------------------
   零配置、实时逐字回显。两个必须处理的坑:

   1. 长句连续输入:浏览器在静音几秒后会自行 onend,即使
      continuous=true。用户说话中间的停顿会被当成结束。
      所以这里维护 wantListening,只要用户没按停止就自动重启,
      让「说一长段话中间可以喘气」真的成立(规格明确要求长句连续)。

   2. 已定稿的文字不能重复发射:每次 onresult 拿到的是从
      resultIndex 起的增量,重启后 resultIndex 归零。用 emittedUpTo
      记录本段已发出的位置,重启时清零并把新一段当作新的开始。
   ============================================================ */

interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((e: SpeechRecognitionEventLike) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  onstart: (() => void) | null;
}

interface SpeechRecognitionEventLike {
  resultIndex: number;
  results: ArrayLike<{ 0: { transcript: string }; isFinal: boolean; length: number }>;
}

type SRConstructor = new () => SpeechRecognitionLike;

function ctor(): SRConstructor | null {
  const w = window as unknown as {
    SpeechRecognition?: SRConstructor;
    webkitSpeechRecognition?: SRConstructor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export function webSpeechAvailable(): { available: boolean; reason?: string } {
  if (typeof window === "undefined") return { available: false, reason: "非浏览器环境" };
  if (!ctor())
    return {
      available: false,
      reason: "这个浏览器不支持网页语音识别(Chrome / Edge / Safari 较新版本可用)",
    };
  if (!window.isSecureContext)
    return { available: false, reason: "需要 HTTPS 或 localhost 才能使用麦克风" };
  return { available: true };
}

const FATAL = new Set(["not-allowed", "service-not-allowed", "audio-capture", "language-not-supported"]);

export function createWebSpeechProvider(lang = "zh-CN"): VoiceProvider {
  let rec: SpeechRecognitionLike | null = null;
  let wantListening = false;
  let cb: VoiceCallbacks | null = null;
  let restartTimer: number | null = null;

  const spinUp = () => {
    const SR = ctor();
    if (!SR || !cb) return;

    const r = new SR();
    r.lang = lang;
    r.continuous = true;
    r.interimResults = true;
    r.maxAlternatives = 1;

    r.onresult = (e) => {
      let interim = "";
      let finalChunk = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const alt = e.results[i][0];
        if (!alt) continue;
        if (e.results[i].isFinal) finalChunk += alt.transcript;
        else interim += alt.transcript;
      }
      if (finalChunk) {
        cb?.onFinal(finalChunk);
        cb?.onInterim("");
      }
      if (interim) cb?.onInterim(interim);
    };

    r.onerror = (e) => {
      // no-speech / aborted 是静音和主动停止的常态,不当错误报给用户
      if (e.error === "no-speech" || e.error === "aborted") return;
      if (FATAL.has(e.error)) {
        wantListening = false;
        cb?.onError(
          e.error === "not-allowed" || e.error === "service-not-allowed"
            ? "麦克风权限被拒绝了。可以改用打字。"
            : `语音识别出错:${e.error}`,
        );
        cb?.onStateChange("idle");
      }
    };

    r.onend = () => {
      // 用户没按停止就是静音触发的自动结束 —— 接着听
      if (wantListening) {
        restartTimer = window.setTimeout(() => {
          if (wantListening) spinUp();
        }, 120);
      } else {
        cb?.onInterim("");
        cb?.onStateChange("idle");
      }
    };

    try {
      r.start();
      rec = r;
      cb?.onStateChange("listening");
    } catch {
      // start() 在上一个实例尚未完全释放时会抛,稍后重试
      if (wantListening) restartTimer = window.setTimeout(spinUp, 200);
    }
  };

  return {
    id: "webspeech",
    async start(callbacks) {
      cb = callbacks;
      wantListening = true;
      spinUp();
    },
    stop() {
      wantListening = false;
      if (restartTimer) {
        clearTimeout(restartTimer);
        restartTimer = null;
      }
      try {
        rec?.stop();
      } catch {
        /* 已经停了 */
      }
      rec = null;
      cb?.onInterim("");
      cb?.onStateChange("idle");
    },
  };
}
