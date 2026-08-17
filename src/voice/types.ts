/* ============================================================
   语音输入(§6.3)
   ------------------------------------------------------------
   语音不是附加功能,是这个工具的主要入口。真实场景是:喝到一杯酒,
   当下有一堆碎的感受,说出来让工具接住。打字效率太低是原始痛点。

   两个 provider,同一套接口:
   - webspeech:浏览器原生。零配置、实时逐字回显,但支持面不齐,
     中文专有名词准确率一般。
   - server:MediaRecorder 录音 → 服务端转发给专业转写服务。
     没有实时回显,但中文风味术语准确率明显更好。

   共同约定(规格硬性要求):
   - 转写结果一律进「可编辑草稿」,绝不自动发送 —— 识别错误不应
     强迫用户重说。
   - 每段输入都带 inputMode,区分语音和打字来源。
   ============================================================ */

export type ProviderId = "webspeech" | "server";
export type VoiceState = "idle" | "listening" | "transcribing";

export interface ProviderAvailability {
  id: ProviderId;
  label: string;
  available: boolean;
  /** 不可用时说清为什么,不要给一个坏掉的按钮 */
  reason?: string;
  /** 是否支持说话时逐字回显 */
  realtime: boolean;
}

export interface VoiceCallbacks {
  /** 确定下来的一段文字,追加进草稿 */
  onFinal: (text: string) => void;
  /** 尚未定稿的文字,只用于显示 */
  onInterim: (text: string) => void;
  onError: (message: string) => void;
  onStateChange: (state: VoiceState) => void;
}

export interface VoiceProvider {
  readonly id: ProviderId;
  start(cb: VoiceCallbacks): Promise<void>;
  stop(): void;
}
