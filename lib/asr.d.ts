export interface AsrOptions {
    apiKey: string;
    resourceId?: string;
    endpoint?: string;
    /** 音频容器：mp3 / wav / ogg / pcm */
    format?: 'mp3' | 'wav' | 'ogg' | 'pcm';
    /** 语言（'' = 自动，官方支持中英+多方言） */
    language?: string;
    /** 单次请求音频上限（秒），超过就分段识别再拼接 */
    chunkSeconds?: number;
    log?: (level: 'debug' | 'info' | 'warn', message: string) => void;
}
export interface AsrResult {
    text: string;
    /** 识别到的分句数 */
    utterances: number;
    /** 原始耗时（毫秒） */
    elapsedMs: number;
}
interface ParsedFrame {
    type: number;
    flags: number;
    compression: number;
    sequence?: number;
    payload: Buffer;
    errorCode?: number;
}
/** 解析服务端下发的一帧（连接关闭/半包时返回 undefined） */
export declare function parseFrame(data: Buffer): ParsedFrame | undefined;
/**
 * 识别一段音频文件。
 * 超过 chunkSeconds（默认 12 秒，官方建议 ≤15 秒）就按字节切成几段分别识别再拼接。
 */
export declare function transcribeAudio(path: string, options: AsrOptions): Promise<AsrResult>;
export {};
