export interface Mp3Info {
    /** 时长（毫秒，取整） */
    durationMs: number;
    /** 采样率（Hz） */
    sampleRate: number;
    /** 解析到的帧数 */
    frames: number;
    /** 是否解析成功（有些文件头不是标准 mp3，比如 exFAT 上的 ID3v2 很长） */
    ok: boolean;
}
/**
 * 读 mp3 头部（跳过 ID3v2）并逐帧累加时长。
 * 只读前 256KB + 每帧头 4 字节，避免大文件整读。
 */
export declare function mp3Duration(path: string): Promise<Mp3Info>;
