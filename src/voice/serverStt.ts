import { authToken } from "../api";
import type { VoiceCallbacks, VoiceProvider } from "./types";

/* ============================================================
   服务端转写 provider
   ------------------------------------------------------------
   MediaRecorder 录音 → 停止时把整段音频 POST 给 /api/stt。
   没有实时逐字回显(录完才转写),换来的是中文风味术语的准确率。
   规格 §6.3 建议生产环境走这条路。

   录音期间没有文字可显示,所以 UI 上显示的是录音时长和音量,
   这部分在组件里做;这里只负责「录 → 传 → 回文字」。
   ============================================================ */

export function mediaRecorderAvailable(): { available: boolean; reason?: string } {
  if (typeof window === "undefined") return { available: false, reason: "非浏览器环境" };
  if (!navigator.mediaDevices?.getUserMedia)
    return { available: false, reason: "这个浏览器不支持录音" };
  if (typeof MediaRecorder === "undefined")
    return { available: false, reason: "这个浏览器不支持 MediaRecorder" };
  if (!window.isSecureContext)
    return { available: false, reason: "需要 HTTPS 或 localhost 才能使用麦克风" };
  return { available: true };
}

function pickMimeType(): string {
  const candidates = [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/ogg;codecs=opus",
    "audio/mp4",
  ];
  for (const c of candidates) {
    if (MediaRecorder.isTypeSupported?.(c)) return c;
  }
  return "";
}

export function createServerSttProvider(): VoiceProvider {
  let recorder: MediaRecorder | null = null;
  let stream: MediaStream | null = null;
  let chunks: Blob[] = [];
  let cb: VoiceCallbacks | null = null;
  let cancelled = false;

  const teardown = () => {
    stream?.getTracks().forEach((t) => t.stop());
    stream = null;
    recorder = null;
  };

  return {
    id: "server",
    async start(callbacks) {
      cb = callbacks;
      cancelled = false;
      chunks = [];
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
          },
        });
      } catch {
        cb.onError("拿不到麦克风权限。可以改用打字。");
        cb.onStateChange("idle");
        return;
      }

      const mimeType = pickMimeType();
      recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunks.push(e.data);
      };

      recorder.onstop = async () => {
        const type = recorder?.mimeType || mimeType || "audio/webm";
        teardown();
        if (cancelled || chunks.length === 0) {
          cb?.onStateChange("idle");
          return;
        }
        cb?.onStateChange("transcribing");
        const blob = new Blob(chunks, { type });
        chunks = [];
        try {
          const res = await fetch("/api/stt", {
            method: "POST",
            headers: {
              "content-type": type,
              ...(authToken() ? { authorization: `Bearer ${authToken()}` } : {}),
            },
            body: blob,
          });
          if (!res.ok) {
            const body = (await res.json().catch(() => ({}))) as { error?: string };
            throw new Error(body.error ?? `转写服务返回 ${res.status}`);
          }
          const data = (await res.json()) as { text?: string };
          const text = (data.text ?? "").trim();
          if (text) cb?.onFinal(text);
          else cb?.onError("没听清,再说一次或者改用打字。");
        } catch (e) {
          cb?.onError(e instanceof Error ? e.message : "转写失败");
        } finally {
          cb?.onStateChange("idle");
        }
      };

      recorder.start(1000);
      cb.onStateChange("listening");
    },

    stop() {
      if (recorder && recorder.state !== "inactive") {
        recorder.stop();
      } else {
        teardown();
        cb?.onStateChange("idle");
      }
    },
  };
}
