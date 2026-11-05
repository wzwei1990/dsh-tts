export interface AudioStoreOptions {
    dir: string;
    /** 最多保留多少个文件（超出删最旧的） */
    keep?: number;
    log?: (level: 'debug' | 'info' | 'warn', message: string) => void;
}
export declare class AudioStore {
    private readonly options;
    constructor(options: AudioStoreOptions);
    dir(): string;
    /** 写一个音频文件，返回可访问的相对 URL 与文件名 */
    save(buffer: Buffer, extension: string): {
        file: string;
        url: string;
    };
    /** 按文件名取绝对路径（拒绝路径穿越） */
    resolve(file: string): string | undefined;
    /** 超出上限时删最旧的（按修改时间） */
    prune(): void;
    stats(): {
        count: number;
        bytes: number;
    };
}
