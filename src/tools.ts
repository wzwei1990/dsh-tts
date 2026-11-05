/**
 * 模型侧工具（2026-11-05）：
 *   - tts_speak：把一段文字交给语音引擎念出来
 *   - tts_status：看当前引擎、队列长度、可用引擎
 *   - tts_clear：清空待播队列（不想让它把积压的话一次念完）
 */
import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'

import type { UtteranceQueue } from './queue.js'
import type { ProviderRegistry, SpeakResult } from './providers.js'

export interface ToolDeps {
  queue: UtteranceQueue
  registry: ProviderRegistry
  speak: (text: string, options?: { rate?: number; volume?: number; pitch?: number; language?: string; voice?: string; source?: string }) => Promise<SpeakResult>
  status: () => { provider: string; enabled: boolean; queue: { length: number; seq: number; dropped: number }; providers: Array<{ id: string; label: string; side: string }> }
  log: (level: 'debug' | 'info' | 'warn', message: string) => void
}

function textOutput() {
  return {
    schema: { type: 'string' as const },
    render: (_args: unknown, value: string) => [{ type: 'text' as const, text: value }],
  }
}

export function registerTools(ctx: Context, deps: ToolDeps): void {
  ctx.tools.register(defineTool({
    name: 'tts_speak',
    description: '把一段文字念出来（语音合成）。浏览器引擎会在网页里朗读；用于让"她"说话、念旁白、直播配音。',
    parameters: {
      text: { type: 'string', required: true, description: '要念的内容（建议一句一句来）' },
      source: { type: 'string', description: '谁说的：agent / bili / live / napcat（给桌宠区分语气，可选）' },
      rate: { type: 'number', description: '语速 0.5~2（可选，默认用设置）' },
      volume: { type: 'number', description: '音量 0~1（可选）' },
    },
    output: textOutput(),
    isConcurrencySafe: () => true,
    execute: async args => {
      const input = args as { text: string; source?: string; rate?: number; volume?: number }
      try {
        const result = await deps.speak(input.text, {
          ...(input.source === undefined ? {} : { source: input.source }),
          ...(input.rate === undefined ? {} : { rate: Number(input.rate) }),
          ...(input.volume === undefined ? {} : { volume: Number(input.volume) }),
        })
        return '🔊 ' + result.note + '\n说：' + result.utterance.text.slice(0, 120)
      } catch (error) {
        return '朗读失败：' + (error instanceof Error ? error.message : String(error))
      }
    },
  }))

  ctx.tools.register(defineTool({
    name: 'tts_status',
    description: '看 TTS 状态：当前引擎、待播队列长度、可用引擎列表。',
    parameters: {},
    output: textOutput(),
    isConcurrencySafe: () => true,
    execute: async () => {
      const status = deps.status()
      const lines = [
        '引擎：' + status.provider + (status.enabled ? '' : '（已关闭）'),
        '队列：' + String(status.queue.length) + ' 条待播（累计 ' + String(status.queue.seq) + ' 条，丢弃 ' + String(status.queue.dropped) + '）',
        '可用引擎：' + status.providers.map(item => item.id + '（' + item.label + '，' + (item.side === 'client' ? '浏览器念' : '服务端出音频') + '）').join('；'),
      ]
      return lines.join('\n')
    },
  }))

  ctx.tools.register(defineTool({
    name: 'tts_clear',
    description: '清空待播队列（积压太多不想一次念完时用）。',
    parameters: {},
    output: textOutput(),
    isConcurrencySafe: () => false,
    execute: async () => {
      const before = deps.queue.stats().length
      deps.queue.clear()
      return '已清空待播队列（丢掉 ' + String(before) + ' 条）'
    },
  }))
}
