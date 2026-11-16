export declare const DEEPSEEK_ASR_URL_DEFAULT = "https://api.deepseek.com/v1/tools/asr";
export declare const ASR_TARGET_SAMPLE_RATE = 16000;
export declare const ASR_MAX_SECONDS = 120;
export declare const ASR_MAX_BYTES: number;
export interface DeepseekAsrOptions {
    apiKey: string;
    baseUrl?: string;
    /** 单段秒数（默认 110，给 120 秒硬限留余量） */
    chunkSeconds?: number;
    /** ffmpeg 可执行文件（默认 PATH 里的 ffmpeg） */
    ffmpegPath?: string;
    timeoutMs?: number;
    fetchImpl?: typeof fetch;
    log?: (level: 'debug' | 'info' | 'warn', message: string) => void;
}
export interface DeepseekAsrResult {
    text: string;
    /** 官方返回的时长（毫秒），多段时为最后一段的 duration_ms；总时长见 durationMsTotal */
    durationMs: number;
    durationMsTotal: number;
    requestIds: string[];
    chunks: number;
    elapsedMs: number;
    provider: 'deepseek';
}
/** 用 ffmpeg 把任意音频转成 16k / 单声道 / 16bit WAV（整段返回 Buffer）。 */
export declare function convertToWav(inputPath: string, ffmpegPath?: string, sampleRate?: number): Promise<Buffer>;
/**
 * 把一段 16bit 单声道 WAV 按最大秒数切成多段 WAV（每段都带合法头）。
 * 不是 WAV（或找不到 data 块）时原样返回单段，交给服务端报错。
 */
export declare function splitWav(buffer: Buffer, maxSeconds: number, fallbackSampleRate?: number): Buffer[];
/** 转写一段本地音频（任意格式，内部用 ffmpeg 转码）。 */
export declare function transcribeDeepseek(inputPath: string, options: DeepseekAsrOptions): Promise<DeepseekAsrResult>;
