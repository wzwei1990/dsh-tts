/**
 * TTS provider 注册表（2026-11-05）。
 *
 * 照官方 @deepseek-ai/dsh-experimental-speech-to-text 的形态：
 *   一个 Service（`tts`）持注册表，各引擎是独立 provider（有 info.id），外层只按 id 选。
 * 这样换引擎不动核心：以后接 ComfyUI / Edge TTS / 云厂商，只是多一个 register。
 */
import type { Utterance } from './queue.js'

export interface TtsProviderInfo {
  id: string
  /** 给人看的名字（设置页/日志） */
  label: string
  /** 这个 provider 声音在哪里出：server=服务端生成音频文件；client=浏览器自己念 */
  side: 'server' | 'client'
}

export interface SpeakOptions {
  rate?: number
  pitch?: number
  volume?: number
  language?: string
  voice?: string
  source?: string
}

export interface SpeakResult {
  provider: string
  /** 交给谁播：client = 已入队等浏览器取；server = 已生成音频 */
  side: 'server' | 'client'
  utterance: Utterance
  /** server 侧才有：音频文件 URL */
  audioUrl?: string
  /** server 侧才有：音频文件绝对路径（QQ 语音等本地消费用） */
  audioPath?: string
  /** 音频时长（毫秒）：桌宠口型 / 进度条 / 事件订阅者用 */
  durationMs?: number
  /** 给调用方看的一句话 */
  note: string
}

export interface TtsProvider {
  info: TtsProviderInfo
  /**
   * 说一句话。
   * - client 侧 provider：把 utterance 入队，等浏览器轮询取走
   * - server 侧 provider：生成音频文件，返回 URL
   */
  speak(text: string, options: SpeakOptions, utterance: Utterance): Promise<SpeakResult>
}

export class ProviderRegistry {
  private readonly providers = new Map<string, TtsProvider>()
  private readonly log: (level: 'debug' | 'info' | 'warn', message: string) => void

  constructor(options: { log: (level: 'debug' | 'info' | 'warn', message: string) => void }) {
    this.log = options.log
  }

  register(provider: TtsProvider): () => void {
    if (this.providers.has(provider.info.id)) {
      throw new Error('TTS provider 已注册：' + provider.info.id)
    }
    this.providers.set(provider.info.id, provider)
    this.log('info', '已注册 TTS 引擎：' + provider.info.label + '（' + provider.info.id + '）')
    return () => {
      this.providers.delete(provider.info.id)
    }
  }

  get(id: string): TtsProvider | undefined {
    return this.providers.get(id)
  }

  /** 所有可用 provider 的 id/label（设置页与 doctor 用） */
  list(): TtsProviderInfo[] {
    return [...this.providers.values()].map(provider => provider.info)
  }
}
