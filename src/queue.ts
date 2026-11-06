/**
 * 待播队列（2026-11-05）。
 *
 * 宿主在 Node 里，声音在浏览器里 —— 所以"服务端生成指令 / 浏览器取走并朗读"。
 * 队列用内存 + 单调递增序号：浏览器带 `since` 轮询，只取比它新的，避免重复播放。
 */

export interface Utterance {
  /** 单调递增序号 */
  seq: number
  /** 要念的文本 */
  text: string
  /** 语速/音高/音量（缺省用配置） */
  rate?: number
  pitch?: number
  volume?: number
  /** 语言（如 zh-CN） */
  language?: string
  /** 指定音色名 */
  voice?: string
  /** 谁要说的（bili / live / napcat / user），给桌宠/舞台区分语气 */
  source: string
  /** 服务端已合成音频时的可访问地址（/dsh-tts/audio/xxx.mp3）；没有则浏览器自己念 */
  audioUrl?: string
  /** 音频时长（毫秒，桌宠口型/进度条用） */
  durationMs?: number
  createdAt: number
}

export interface PendingResult {
  items: Utterance[]
  /** 下次轮询带上它，就不会重复取 */
  cursor: number
}

export class UtteranceQueue {
  private readonly max: number
  private items: Utterance[] = []
  private seq = 0
  private dropped = 0

  constructor(max: number) {
    this.max = Math.max(1, max)
  }

  push(input: Omit<Utterance, 'seq' | 'createdAt'>): Utterance {
    this.seq += 1
    const utterance: Utterance = { ...input, seq: this.seq, createdAt: Date.now() }
    this.items.push(utterance)
    // 队列满了丢最旧的（宁可少念一句，也不让内存涨）
    while (this.items.length > this.max) {
      this.items.shift()
      this.dropped += 1
    }
    return utterance
  }

  /**
   * 取 since 之后的所有条目（默认全量，用于首次同步）。
   *
   * since > 0 说明浏览器已经播到那一带了 —— 顺手把更旧的条目裁掉。
   * 这样即使有人把播放游标清零，也不会把历史积压当新内容复读一遍。
   */
  pending(since = 0): PendingResult {
    if (since > 0) this.trimThrough(since)
    const items = this.items.filter(item => item.seq > since)
    return { items, cursor: items.length > 0 ? (items[items.length - 1]?.seq ?? since) : this.seq }
  }

  /** 丢掉 seq <= upto 的条目（已被消费的） */
  trimThrough(upto: number): number {
    const before = this.items.length
    this.items = this.items.filter(item => item.seq > upto)
    return before - this.items.length
  }

  /** 当前游标（浏览器首次进来时用它对齐，避免把历史重新念一遍） */
  cursor(): number {
    return this.seq
  }

  stats(): { length: number; seq: number; dropped: number } {
    return { length: this.items.length, seq: this.seq, dropped: this.dropped }
  }

  clear(): void {
    this.items = []
  }

  /** 撤掉刚入队的那条（"只合成不入队"的场景用） */
  removeLast(): void {
    this.items.pop()
  }
}
