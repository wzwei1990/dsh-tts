import { type ConfigShape } from './config.js';
/** 从一段 YAML 文本里抽出 `- id: dsh-tts` 块的 config（扁平键值） */
export declare function parseTtsBlock(text: string, pluginId?: string): Record<string, string>;
export interface LiveConfigOptions {
    /** 初始配置（apply 收到的） */
    initial: ConfigShape;
    log?: (level: 'debug' | 'info' | 'warn', message: string) => void;
}
/**
 * 会自己从磁盘刷新的配置。
 * `get()` 每次都尝试检查 mtime（最多 1 秒一次），文件变了就重读。
 */
export declare class LiveConfig {
    private current;
    private readonly options;
    private lastCheck;
    private file;
    private mtime;
    constructor(options: LiveConfigOptions);
    private locate;
    /** 只读当前值 */
    peek(): ConfigShape;
    /** 需要时刷新，返回最新配置 */
    get(): ConfigShape;
    private refresh;
}
