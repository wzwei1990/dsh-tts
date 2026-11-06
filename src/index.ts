/**
 * dsh-tts：把文字变成声音（2026-11-05）。
 *
 * 引擎（provider 注册表，换引擎不动核心）：
 *   - edge   微软 Edge TTS：免费免 key，服务端合成 mp3（默认）
 *   - volc   火山方舟 TTS：要 appId/token，服务端合成 mp3
 *   - browser 浏览器 speechSynthesis：零依赖，前端直接念
 *
 * 服务端合成的音频落到 `$DSH_HOME/dsh-tts/audio/`，由 `/dsh-tts/audio/<file>` 提供；
 * 前端播放器轮询 `/dsh-tts/api/pending` 取到条目后：有 audioUrl 就播音频，没有就用 speechSynthesis。
 *
 * 对外契约：ctx.provide('dshTts', { speak, pending, cursor, clear, providers, status })
 */
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

import type { Context } from '@deepseek-ai/cordis'

import { AudioStore } from './audio.js'
import { Config, DEFAULTS, resolveConfig, type ConfigShape } from './config.js'
import { synthesizeEdge } from './edge.js'
import { transcribeAudio } from './asr.js'
import { mp3Duration } from './mp3.js'
import { LiveConfig } from './liveconfig.js'
import { UtteranceQueue, type Utterance, type PendingResult } from './queue.js'
import { ProviderRegistry, type SpeakOptions, type SpeakResult, type TtsProvider } from './providers.js'
import { registerTools } from './tools.js'
import { voicesFor } from './voices.js'
import { synthesizeVolc } from './volc.js'

export { Config }

export const name = 'dsh-tts'

/** tools 必备；webServer 用于挂 /dsh-tts/api（试听、待播队列、音频）。不 inject 的话宿主不会把 webServer 给我，路由就不存在 → 试听 404 */
export const inject = ['tools', 'webServer']

const LEVEL_RANK: Record<string, number> = { debug: 0, info: 1, warn: 2 }

/** 音色解析：显式传参 > 自定义输入 > 下拉选择 */
function resolveVoice(explicit: string | undefined, selected: string, custom: string): string {
  if (explicit !== undefined && explicit !== '') return explicit
  if (selected === '__custom__') return custom.trim() !== '' ? custom.trim() : 'zh-CN-XiaoxiaoNeural'
  return selected
}



function edgeProvider(queue: UtteranceQueue, config: () => ConfigShape, audio: AudioStore): TtsProvider {
  return {
    info: { id: 'edge', label: '微软 Edge TTS（免费免 key）', side: 'server' },
    async speak(text, options, utterance) {
      const cfg = config()
      const result = await synthesizeEdge(text, {
        voice: resolveVoice(options.voice, cfg.edgeVoice, cfg.edgeVoiceCustom),
        ratePercent: cfg.edgeRatePercent,
        pitchHz: cfg.edgePitchHz,
        volumePercent: cfg.edgeVolumePercent,
      })
      const saved = audio.save(result.audio, result.extension)
      const queued = queue.push({
        text,
        source: options.source ?? utterance.source,
        audioUrl: saved.url,
      })
      return {
        provider: 'edge',
        side: 'server',
        utterance: queued,
        audioUrl: saved.url,
        audioPath: audio.resolve(saved.file),
        note: '已合成 ' + String(Math.round(result.audio.length / 1024)) + 'KB 音频（' + cfg.edgeVoice + '），浏览器会播放',
      }
    },
  }
}

function volcProvider(queue: UtteranceQueue, config: () => ConfigShape, audio: AudioStore): TtsProvider {
  return {
    info: { id: 'volc', label: '火山方舟 TTS（豆包音色）', side: 'server' },
    async speak(text, options, utterance) {
      const cfg = config()
      const result = await synthesizeVolc(text, {
        apiKey: cfg.volcApiKey,
        resourceId: cfg.volcResourceId,
        speaker: resolveVoice(options.voice, cfg.volcSpeaker, cfg.volcSpeakerCustom),
        format: cfg.volcFormat,
        sampleRate: cfg.volcSampleRate,
        ...(cfg.volcEndpoint !== '' ? { endpoint: cfg.volcEndpoint } : {}),
      })
      const saved = audio.save(result.audio, result.extension)
      const queued = queue.push({
        text,
        source: options.source ?? utterance.source,
        audioUrl: saved.url,
      })
      return {
        provider: 'volc',
        side: 'server',
        utterance: queued,
        audioUrl: saved.url,
        audioPath: audio.resolve(saved.file),
        note: '已合成 ' + String(Math.round(result.audio.length / 1024)) + 'KB 音频（' + cfg.volcSpeaker + '），浏览器会播放',
      }
    },
  }
}

export function apply(ctx: Context, rawConfig: ConfigShape): void {
  const initial = resolveConfig(rawConfig)
  const live = new LiveConfig({ initial, log: (level, message) => { if ((LEVEL_RANK[level] ?? 1) >= (LEVEL_RANK[initial.logLevel] ?? 1)) console.log('[dsh-tts][' + level + '] ' + message) } })
  /** 每次调用都拿最新配置（宿主写回 YAML 后自动生效，不用重启） */
  const config = (): ConfigShape => live.get()
  const threshold = LEVEL_RANK[initial.logLevel] ?? 1
  const log = (level: 'debug' | 'info' | 'warn', message: string): void => {
    if ((LEVEL_RANK[level] ?? 1) < threshold) return
    const host = ctx as unknown as { logger?: (level: string, message: string) => void }
    if (typeof host.logger === 'function') host.logger(level, '[dsh-tts] ' + message)
    else console.log('[dsh-tts][' + level + '] ' + message)
  }

  const dshHome = process.env.DSH_HOME !== undefined && process.env.DSH_HOME !== ''
    ? process.env.DSH_HOME
    : join(homedir(), '.dsh')
  const audioDir = initial.audioDir.trim() !== '' ? initial.audioDir.trim() : join(dshHome, 'dsh-tts', 'audio')
  const audio = new AudioStore({ dir: audioDir, keep: initial.audioKeep, log })

  const queue = new UtteranceQueue(initial.queueSize)
  const registry = new ProviderRegistry({ log })
  registry.register(edgeProvider(queue, config, audio))
  registry.register(volcProvider(queue, config, audio))

  /** 解析音频时长并写回 utterance（失败返回 undefined，不影响朗读） */
  const durationOf = async (path: string | undefined, utterance: Utterance): Promise<number | undefined> => {
    if (path === undefined) return undefined
    try {
      const info = await mp3Duration(path)
      if (!info.ok) return undefined
      utterance.durationMs = info.durationMs
      return info.durationMs
    } catch {
      return undefined
    }
  }

  const speak = async (text: string, options: SpeakOptions = {}): Promise<SpeakResult> => {
    if (!config().enabled) throw new Error('TTS 已关闭（设置页 enabled）')
    const trimmed = text.trim()
    if (trimmed === '') throw new Error('要念的内容是空的')
    const clipped = trimmed.length > config().maxChars ? trimmed.slice(0, config().maxChars) + '…' : trimmed
    const provider = registry.get(config().provider)
    if (provider === undefined) {
      throw new Error('没有这个 TTS 引擎：' + config().provider + '（可选：' + registry.list().map(item => item.id).join('/') + '）')
    }
    const placeholder: Utterance = { seq: 0, text: clipped, source: options.source ?? 'agent', createdAt: Date.now() }
    const result = await provider.speak(clipped, options, placeholder)
    // 补音频时长：桌宠口型 / 进度条 / 事件订阅者都要用；解析失败也不影响朗读
    const durationMs = await durationOf(result.audioPath, result.utterance)
    if (durationMs !== undefined) result.durationMs = durationMs
    log('info', '朗读 ' + String(result.utterance.seq) + '：' + result.provider + ' ← ' + clipped.slice(0, 30)
      + (durationMs === undefined ? '' : '（' + (durationMs / 1000).toFixed(1) + 's）'))
    return result
  }

  /** 只合成不入队：给 QQ 语音这类"自己拿文件去发"的消费者 */
  const synthesize = async (text: string, options: SpeakOptions = {}): Promise<{ path: string; url: string; provider: string; durationMs?: number }> => {
    const trimmed = text.trim()
    if (trimmed === '') throw new Error('要念的内容是空的')
    const clipped = trimmed.length > config().maxChars ? trimmed.slice(0, config().maxChars) + '…' : trimmed
    const provider = registry.get(config().provider)
    if (provider === undefined) throw new Error('没有这个 TTS 引擎：' + config().provider)
    if (provider.info.side !== 'server') {
      throw new Error('引擎 ' + config().provider + ' 在浏览器里发声，拿不到音频文件；发 QQ 语音请用 edge 或 volc')
    }
    const placeholder: Utterance = { seq: 0, text: clipped, source: options.source ?? 'agent', createdAt: Date.now() }
    const result = await provider.speak(clipped, options, placeholder)
    if (result.audioPath === undefined || result.audioUrl === undefined) {
      throw new Error('引擎 ' + config().provider + ' 没有产出音频文件')
    }
    // 合成专用不进队列：把刚入队的那条撤掉（避免浏览器又念一遍）
    queue.removeLast()
    const durationMs = await durationOf(result.audioPath, placeholder)
    return { path: result.audioPath, url: result.audioUrl, provider: config().provider, durationMs }
  }

  /**
   * 语音识别：把一段音频文件转成文字（火山 ASR）。
   * 和 TTS 共用 volcApiKey；没配 key / 关掉 asrEnabled 会明确报错，方便通道提示用户。
   */
  const transcribe = async (path: string, options: { language?: string } = {}): Promise<{ text: string; elapsedMs: number; provider: 'volc' }> => {
    const cfg = config()
    if (!cfg.asrEnabled) throw new Error('语音识别已关闭（设置页 asrEnabled）')
    if (cfg.volcApiKey === '') throw new Error('语音识别需要 volcApiKey（和火山 TTS 共用）')
    const result = await transcribeAudio(path, {
      apiKey: cfg.volcApiKey,
      resourceId: cfg.asrResourceId,
      format: cfg.asrFormat,
      language: options.language ?? cfg.asrLanguage,
      chunkSeconds: cfg.asrChunkSeconds,
      log,
    })
    log('info', '语音识别完成：' + result.text.slice(0, 40) + '（' + String(result.elapsedMs) + 'ms）')
    return { text: result.text, elapsedMs: result.elapsedMs, provider: 'volc' }
  }

  const api = {
    speak,
    synthesize,
    transcribe,
    pending: (since = 0): PendingResult => queue.pending(since),
    cursor: () => queue.cursor(),
    clear: () => queue.clear(),
    providers: () => registry.list(),
    voices: (provider?: string) => voicesFor(provider ?? config().provider),
    status: () => ({
      provider: config().provider,
      enabled: config().enabled,
      queue: queue.stats(),
      providers: registry.list(),
      audio: audio.stats(),
      audioDir: audio.dir(),
    }),
  }

  try {
    const host = ctx as unknown as { provide?: (name: string, value: unknown) => void }
    host.provide?.('dshTts', api)
  } catch {
    log('debug', '宿主不支持 provide(dshTts)，跳过服务注册（工具仍可用）')
  }

  /**
   * 自动朗读：监听会话事件，把模型的最终回复念出来。
   *
   * - 只认 assistant/message，且不含 tool-call 块（中间轮次不念）
   * - 同一会话 900ms 内的多条合并，只念最后一条
   * - 跳过 autoReadSkipPrefix（默认 napcat-，QQ 那边自己发语音，不重复）
   */
  let autoReadTimer: ReturnType<typeof setTimeout> | undefined
  const autoReadPending = new Map<string, string>()
  const autoReadFlush = (): void => {
    autoReadTimer = undefined
    for (const [sessionId, text] of autoReadPending) {
      autoReadPending.delete(sessionId)
      if (text.trim() === '') continue
      void speak(text, { source: 'autoread' }).catch((error: unknown) => {
        log('debug', '自动朗读失败（' + sessionId + '）: ' + (error instanceof Error ? error.message : String(error)))
      })
    }
  }
  const onSessionEvent = (session: unknown, event: unknown): void => {
    if (!config().autoRead) return
    if ((event as { type?: string }).type !== 'assistant/message') return
    const sessionId = String((session as { header?: { id?: unknown }; id?: unknown }).header?.id
      ?? (session as { id?: unknown }).id ?? '')
    const skip = config().autoReadSkipPrefix.split(/[,，\s]+/).map(part => part.trim()).filter(part => part !== '')
    if (skip.some(prefix => sessionId.startsWith(prefix))) return
    const payload = ((event as { payload?: unknown }).payload ?? (event as { data?: unknown }).data ?? {}) as Record<string, unknown>
    const message = (payload.message ?? payload) as { content?: unknown }
    const content = message.content
    if (!Array.isArray(content)) return
    const blocks = content as Array<{ type?: string; text?: string }>
    if (blocks.some(block => block.type === 'tool-call' || block.type === 'tool-use')) return
    const text = blocks.filter(block => block.type === 'text').map(block => String(block.text ?? '')).join('').trim()
    if (text === '') return
    autoReadPending.set(sessionId, text)
    if (autoReadTimer === undefined) autoReadTimer = setTimeout(autoReadFlush, 900)
  }
  try {
    const on = (ctx as unknown as { on?: (name: string, handler: (a: unknown, b: unknown) => void) => unknown }).on
    if (typeof on === 'function') {
      on.call(ctx, 'session/event', onSessionEvent)
      log('info', '已订阅 session/event（自动朗读' + (config().autoRead ? '已开启' : '默认关闭') + '）')
    } else {
      log('debug', 'ctx.on 不可用，自动朗读不可用')
    }
  } catch (error) {
    log('debug', '订阅 session/event 失败: ' + (error instanceof Error ? error.message : String(error)))
  }

  registerTools(ctx, { queue, registry, speak, status: api.status, log , transcribe })

  // HTTP：待播队列 + 音频文件
  try {
    const web = (ctx as unknown as {
      webServer?: {
        register?: (route: {
          kind: 'prefix' | 'exact'
          path: string
          handler: (req: unknown, res: unknown) => void
        }) => () => void
      }
    }).webServer
    if (web?.register !== undefined) {
      web.register({
        kind: 'prefix',
        path: '/dsh-tts/api',
        handler: (req, res) => {
          const request = req as { url?: string }
          const response = res as {
            setHeader?: (k: string, v: string) => void
            end?: (body?: string) => void
            statusCode?: number
            writeHead?: (code: number, headers: Record<string, string>) => void
            pipe?: (stream: unknown) => void
          }
          const url = new URL('http://local' + (request.url ?? '/'))
          const json = (payload: unknown): void => {
            response.setHeader?.('content-type', 'application/json; charset=utf-8')
            response.setHeader?.('cache-control', 'no-store')
            response.end?.(JSON.stringify(payload))
          }
          if (url.pathname === '/dsh-tts/api/pending') {
            const since = Number(url.searchParams.get('since') ?? '0')
            json(queue.pending(Number.isFinite(since) ? since : 0))
            return
          }
          if (url.pathname === '/dsh-tts/api/test') {
            // 用当前引擎合成一句，返回音频地址（浏览器朗读则告诉前端自己念）
            const text = url.searchParams.get('text') ?? '你好，这是语音试听。'
            void (async () => {
              try {
                const provider = registry.get(config().provider)
                if (provider === undefined || provider.info.side === 'client') {
                  json({ browser: true, text })
                  return
                }
                const made = await synthesize(text, { source: 'audition' })
                json({ url: made.url, provider: made.provider, text, size: (() => { try { return readFileSync(audio.resolve(made.url.split('/').pop() ?? '') ?? '').length } catch { return 0 } })() })
              } catch (error) {
                json({ error: error instanceof Error ? error.message : String(error) })
              }
            })()
            return
          }
          if (url.pathname === '/dsh-tts/api/clear') {
            // 清空待播队列：模型连着说了太多，用户想立刻闭嘴
            const cleared = queue.stats().length
            queue.clear()
            json({ cleared })
            return
          }
          if (url.pathname === '/dsh-tts/api/voices') {
            const provider = url.searchParams.get('provider') ?? config().provider
            json({ provider, voices: voicesFor(provider) })
            return
          }
          if (url.pathname === '/dsh-tts/api/info') {
            json({ config: { ...config(), volcApiKey: config().volcApiKey === '' ? '' : '***' }, ...api.status() })
            return
          }
          response.statusCode = 404
          json({ error: 'not found' })
        },
      })
      web.register({
        kind: 'prefix',
        path: '/dsh-tts/audio',
        handler: (req, res) => {
          const request = req as { url?: string }
          const response = res as {
            writeHead?: (code: number, headers: Record<string, string>) => void
            end?: (body?: string) => void
            pipe?: (stream: unknown) => void
          }
          const url = new URL('http://local' + (request.url ?? '/'))
          const file = decodeURIComponent(url.pathname.replace('/dsh-tts/audio/', ''))
          const full = audio.resolve(file)
          if (full === undefined) {
            response.writeHead?.(404, { 'content-type': 'text/plain; charset=utf-8' })
            response.end?.('not found')
            return
          }
          // 宿主发文件的标准写法是 writeHead + end(buffer)（见 dsh-client-modules 发 bundle）。
          // 之前用 createReadStream().pipe(res)：res 上没有 pipe 时什么都不发，连接就断（浏览器报 net::ERR_CONNECTION_CLOSED）。
          try {
            const body = readFileSync(full)
            response.writeHead?.(200, {
              'content-type': file.endsWith('.mp3') ? 'audio/mpeg' : 'application/octet-stream',
              'content-length': String(body.length),
              'cache-control': 'public, max-age=3600',
              'accept-ranges': 'none',
            })
            response.end?.(body as never)
          } catch (error) {
            response.writeHead?.(500, { 'content-type': 'text/plain; charset=utf-8' })
            response.end?.('read failed: ' + (error instanceof Error ? error.message : String(error)))
          }
        },
      })
      log('info', 'HTTP 已挂载：/dsh-tts/api/pending、/dsh-tts/audio（目录 ' + audioDir + '）')
    } else {
      log('warn', '宿主没有 webServer 服务：浏览器拿不到队列/音频（工具仍可用）')
    }
  } catch (error) {
    log('warn', '挂载 /dsh-tts 路由失败: ' + (error instanceof Error ? error.message : String(error)))
  }

  log('info', 'dsh-tts 已加载（引擎=' + config().provider + '，可用：' + registry.list().map(item => item.id).join('/') + '）')
  if (config().provider === 'volc' && config().volcApiKey === '') {
    log('warn', '引擎选了火山方舟，但 API Key 还没填，tts_speak 会失败')
  }
  if (config().provider === DEFAULTS.provider) {
    log('debug', '默认引擎 Edge TTS：免费免 key，直接能用')
  }
}
