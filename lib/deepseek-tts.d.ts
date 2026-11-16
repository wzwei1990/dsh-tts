/**
 * DeepSeek 官方语音合成（2026-11-16 接入）。
 *
 * 官方文档：https://api-docs.deepseek.com/zh-cn/guides/tts
 *   POST https://api.deepseek.com/v1/tools/tts
 *   body: { text, voice_id: 'stella'|'tide', format: 'wav'|'pcm', filter_markdown }
 *   限制：单请求 ≤1 万**计费字符**（中文按 2 计）、请求体 ≤64 KiB、最多 30 分钟音频
 *   输出：wav（默认）或 24 kHz / 16 bit / 单声道裸 PCM，边合成边流式返回
 *   音色只有两个：stella（女，默认）/ tide（男）；**不支持语速、情感、音色克隆**
 *   错误码：400（无可读文本/内容审核）/ 429（并发超限）/ 503（繁忙）/ 504（超时）
 *
 * 这里统一按 `format: 'pcm'` 分片请求，最后拼成**一个 WAV**：
 *   - 不引入 ffmpeg 依赖（WAV 头自己写）
 *   - 时长可直接由 PCM 字节数算出，交给现有 durationOf 之外的新路径使用
 */
export declare const DEEPSEEK_TTS_URL = "https://api.deepseek.com/v1/tools/tts";
export declare const DEEPSEEK_SAMPLE_RATE = 24000;
export declare const MAX_BILLED_CHARS = 10000;
export declare const MAX_BODY_BYTES: number;
export interface DeepseekTtsOptions {
    apiKey: string;
    voiceId?: string;
    baseUrl?: string;
    timeoutMs?: number;
    /** 单次请求的计费字符上限（默认 10000） */
    maxBilledChars?: number;
    /** 单次请求体积上限（默认 64 KiB，留出 JSON 包装余量） */
    maxBodyBytes?: number;
    fetchImpl?: typeof fetch;
}
export interface DeepseekTtsResult {
    audio: Buffer;
    mime: string;
    extension: string;
    durationMs: number;
    /** 实际切成几段请求 */
    chunks: number;
    /** 计费字符数（中文按 2 计） */
    billed: number;
}
/** 计费字符：中日韩统一表意文字（含扩展 A、兼容区）按 2 计，其它（字母/数字/空格/标点）按 1。 */
export declare function billedChars(text: string): number;
/**
 * 把长文本切成若干段，每段都不超过「计费字符上限」与「请求体上限」。
 * 单句本身超限时按字符硬切（不切坏代理对）。
 */
export declare function splitForTts(text: string, limit?: number, maxBytes?: number): string[];
/** 24kHz 16bit 单声道 PCM 的字节数 → 毫秒 */
export declare function pcmDurationMs(bytes: number, sampleRate?: number): number;
/** 裸 PCM 加 44 字节 WAV 头（RIFF/WAVE/fmt/data），浏览器与大多数播放器可直接播。 */
export declare function pcmToWav(pcm: Buffer, sampleRate?: number, channels?: number): Buffer;
/** 读 WAV 头，返回 data 段起点与采样率（只支持标准 44 字节头 / 带扩展 fmt 的常见写法）。 */
export declare function readWavHeader(buffer: Buffer): {
    dataOffset: number;
    dataLength: number;
    sampleRate: number;
    channels: number;
} | undefined;
/**
 * 合成一段文本 → 一个 WAV。超限自动分段，最后把 PCM 拼起来只写一次 WAV 头。
 * 任一失败直接抛错（调用方决定是否回落到 edge / volc）。
 */
export declare function synthesizeDeepseek(text: string, options: DeepseekTtsOptions): Promise<DeepseekTtsResult>;
