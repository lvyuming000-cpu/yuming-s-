/* ============================================================
   语音转文字(§6.3)
   ------------------------------------------------------------
   规格:「Web 端可用 Web Speech API,但浏览器支持不一;生产建议接
   专业语音转文字服务(如 Whisper API 或国内厂商),准确率对中文风味
   术语更重要。」

   所以客户端有两个 provider:
   - webspeech:浏览器原生,零配置,实时逐字回显,但支持面不齐
   - server:录音后传到这里,转发给配置的转写服务,准确率高

   本文件是 server provider 的服务端半边。走 OpenAI 兼容的
   /audio/transcriptions 协议 —— Whisper API、多数自建服务、
   以及大部分国内厂商的兼容层都吃这个形状。没配置就明确回 501,
   客户端据此隐藏这个 provider,而不是给一个坏掉的按钮。
   ============================================================ */

export interface SttConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
  language: string;
  /** 风味术语提示,显著改善中文专有名词的转写准确率 */
  prompt: string;
}

export function sttConfig(): SttConfig | null {
  const baseUrl = process.env.STT_BASE_URL;
  if (!baseUrl) return null;
  return {
    baseUrl: baseUrl.replace(/\/$/, ""),
    apiKey: process.env.STT_API_KEY ?? "",
    model: process.env.STT_MODEL ?? "whisper-1",
    language: process.env.STT_LANGUAGE ?? "zh",
    prompt:
      process.env.STT_PROMPT ??
      "饮品风味研发对话。可能出现的词:骨架、对抗性、缓冲、桥接剂、重量锚点、点睛香料、文化符号、前调、中调、后调、单宁、涩、气泡、抹茶、龙井、乌龙、金酒、威士忌、苦精、利口酒。",
  };
}

export async function transcribe(
  audio: Buffer,
  contentType: string,
): Promise<string> {
  const cfg = sttConfig();
  if (!cfg) throw new Error("STT_NOT_CONFIGURED");

  const ext = extensionFor(contentType);
  const form = new FormData();
  form.append("file", new Blob([new Uint8Array(audio)], { type: contentType }), `audio.${ext}`);
  form.append("model", cfg.model);
  form.append("language", cfg.language);
  if (cfg.prompt) form.append("prompt", cfg.prompt);

  const res = await fetch(`${cfg.baseUrl}/audio/transcriptions`, {
    method: "POST",
    headers: cfg.apiKey ? { authorization: `Bearer ${cfg.apiKey}` } : undefined,
    body: form,
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`转写服务返回 ${res.status}${detail ? `: ${detail.slice(0, 300)}` : ""}`);
  }

  const data = (await res.json()) as { text?: string };
  return (data.text ?? "").trim();
}

function extensionFor(contentType: string): string {
  const t = contentType.split(";")[0].trim();
  const map: Record<string, string> = {
    "audio/webm": "webm",
    "audio/ogg": "ogg",
    "audio/mp4": "mp4",
    "audio/mpeg": "mp3",
    "audio/wav": "wav",
    "audio/x-wav": "wav",
    "audio/flac": "flac",
  };
  return map[t] ?? "webm";
}
