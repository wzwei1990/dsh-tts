/**
 * 待播队列（2026-11-05）。
 *
 * 宿主在 Node 里，声音在浏览器里 —— 所以"服务端生成指令 / 浏览器取走并朗读"。
 * 队列用内存 + 单调递增序号：浏览器带 `since` 轮询，只取比它新的，避免重复播放。
 */
export class UtteranceQueue {
    max;
    items = [];
    seq = 0;
    dropped = 0;
    constructor(max) {
        this.max = Math.max(1, max);
    }
    push(input) {
        this.seq += 1;
        const utterance = { ...input, seq: this.seq, createdAt: Date.now() };
        this.items.push(utterance);
        // 队列满了丢最旧的（宁可少念一句，也不让内存涨）
        while (this.items.length > this.max) {
            this.items.shift();
            this.dropped += 1;
        }
        return utterance;
    }
    /** 取 since 之后的所有条目（默认全量，用于首次同步） */
    pending(since = 0) {
        const items = this.items.filter(item => item.seq > since);
        return { items, cursor: items.length > 0 ? (items[items.length - 1]?.seq ?? since) : this.seq };
    }
    /** 当前游标（浏览器首次进来时用它对齐，避免把历史重新念一遍） */
    cursor() {
        return this.seq;
    }
    stats() {
        return { length: this.items.length, seq: this.seq, dropped: this.dropped };
    }
    clear() {
        this.items = [];
    }
}
