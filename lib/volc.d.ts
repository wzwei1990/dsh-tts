/**
 * 火山方舟 TTS 引擎（2026-11-05，按官方 Agent Plan 文档的 **v3** 接口实现）。
 *
 * 官方 HTTP 单流接口（一次发文本、流式返回音频片段）：
 *   POST https://openspeech.bytedance.com/api/v3/plan/tts/unidirectional
 *   headers:
 *     X-Api-Key: <专属 API Key>
 *     X-Api-Resource-Id: seed-tts-2.0        （豆包语音合成模型 2.0）
 *     X-Control-Require-Usage-Tokens-Return: *
 *     Content-Type: application/json
 *   body:
 *     { req_params: { text, speaker: "zh_female_vv_uranus_bigtts",
 *                     audio_params: { format: "mp3", sample_rate: 24000 } } }
 *   响应：**流式 JSON 行**，每行 { code, data: <base64 音频>, message }
 *          code === 0 → 追加音频；code === 20000000 → 结束；其它 >0 → 报错
 *
 * 文档：https://docs.volcengine.com/docs/ark/agent-plan-personal-voice-model
 */
export interface VolcOptions {
    /** 专属 API Key（火山方舟控制台） */
    apiKey: string;
    /** 资源 id，默认 seed-tts-2.0 */
    resourceId?: string;
    /** 音色 speaker，例如 zh_female_vv_uranus_bigtts */
    speaker?: string;
    /** 输出格式：mp3 / wav / pcm */
    format?: string;
    /** 采样率 */
    sampleRate?: number;
    /** 接口地址（留空=官方） */
    endpoint?: string;
    timeoutMs?: number;
}
export interface VolcResult {
    audio: Buffer;
    mime: string;
    extension: string;
}
export declare function synthesizeVolc(text: string, options: VolcOptions): Promise<VolcResult>;
