/**
 * 待播队列（2026-11-05）。
 *
 * 宿主在 Node 里，声音在浏览器里 —— 所以"服务端生成指令 / 浏览器取走并朗读"。
 * 队列用内存 + 单调递增序号：浏览器带 `since` 轮询，只取比它新的，避免重复播放。
 */
export interface Utterance {
    /** 单调递增序号 */
    seq: number;
    /** 要念的文本 */
    text: string;
    /** 语速/音高/音量（缺省用配置） */
    rate?: number;
    pitch?: number;
    volume?: number;
    /** 语言（如 zh-CN） */
    language?: string;
    /** 指定音色名 */
    voice?: string;
    /** 谁要说的（bili / live / napcat / user），给桌宠/舞台区分语气 */
    source: string;
    /** 服务端已合成音频时的可访问地址（/dsh-tts/audio/xxx.mp3）；没有则浏览器自己念 */
    audioUrl?: string;
    createdAt: number;
}
export interface PendingResult {
    items: Utterance[];
    /** 下次轮询带上它，就不会重复取 */
    cursor: number;
}
export declare class UtteranceQueue {
    private readonly max;
    private items;
    private seq;
    private dropped;
    constructor(max: number);
    push(input: Omit<Utterance, 'seq' | 'createdAt'>): Utterance;
    /** 取 since 之后的所有条目（默认全量，用于首次同步） */
    pending(since?: number): PendingResult;
    /** 当前游标（浏览器首次进来时用它对齐，避免把历史重新念一遍） */
    cursor(): number;
    stats(): {
        length: number;
        seq: number;
        dropped: number;
    };
    clear(): void;
    /** 撤掉刚入队的那条（"只合成不入队"的场景用） */
    removeLast(): void;
}
