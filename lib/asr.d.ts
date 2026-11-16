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
 * 超过 chunkSeconds（默认 60 秒）就按字节切成几段分别识别再拼接。
 * 注意：官方对这个接口**没有单次时长上限**——「输入大于 15 秒或发完最后一包才返回结果」
 * 说的是返回时机，不是限制（2026-11-16 按 [大模型流式语音识别](https://www.volcengine.com/docs/6561/1354869) 核对）。
 */
export declare function transcribeAudio(path: string, options: AsrOptions): Promise<AsrResult>;
export {};
