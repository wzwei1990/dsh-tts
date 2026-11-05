export interface EdgeVoiceOptions {
    /** 音色名，如 zh-CN-XiaoxiaoNeural */
    voice?: string;
    /** 语速百分比，如 +10% / -20% */
    ratePercent?: number;
    /** 音高，单位 Hz，如 +20 / -10 */
    pitchHz?: number;
    /** 音量百分比，如 +0% / +50% */
    volumePercent?: number;
    timeoutMs?: number;
}
export interface EdgeResult {
    audio: Buffer;
    mime: string;
    extension: string;
}
/** Sec-MS-GEC 签名 */
export declare function secMsGec(nowMs?: number): string;
export declare function buildSsml(text: string, options?: EdgeVoiceOptions): string;
/** 合成一句话（遇到 429 限流会重试两次） */
export declare function synthesizeEdge(text: string, options?: EdgeVoiceOptions): Promise<EdgeResult>;
