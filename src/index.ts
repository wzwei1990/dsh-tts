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
import { appendFile, readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

import type { Context } from '@deepseek-ai/cordis'

import { AudioStore } from './audio.js'
import { Config, DEFAULTS, resolveConfig, type ConfigShape } from './config.js'
import { synthesizeEdge } from './edge.js'
import { transcribeAudio } from './asr.js'
import { synthesizeDeepseek, readWavHeader, pcmDurationMs } from './deepseek-tts.js'
import { transcribeDeepseek } from './deepseek-asr.js'
import { mp3Duration } from './mp3.js'
import { sanitizeForSpeech, splitSentences } from './text.js'
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
/**
 * 取 DeepSeek API Key：设置页显式填写 → 宿主凭据服务（ctx.credentials，读 ~/.dsh/.credentials.yaml
 * 的 DEEPSEEK_API_KEY，与模型 provider 同一把）→ 环境变量。
 * 这样装了插件就能直接用模型那把 key，不需要用户再填一遍。
 */
async function resolveDeepseekKey(ctx: Context, explicit: string): Promise<string> {
  const own = explicit.trim()
  if (own !== '') return own
  try {
    const holder = ctx as unknown as {
      get?: (name: string) => unknown
      credentials?: { resolve?: (ref: string) => Promise<{ value?: unknown } | undefined> }
    }
    const service = (holder.get?.('credentials') ?? holder.credentials) as
      | { resolve?: (ref: string) => Promise<{ value?: unknown } | undefined> }
      | undefined
    const resolved = await service?.resolve?.('DEEPSEEK_API_KEY')
    if (resolved?.value !== undefined && resolved.value !== null && String(resolved.value) !== '') return String(resolved.value)
  } catch {
    // 宿主没提供服务就退回环境变量
  }
  return process.env.DEEPSEEK_API_KEY ?? ''
}

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

function deepseekProvider(ctx: Context, queue: UtteranceQueue, config: () => ConfigShape, audio: AudioStore): TtsProvider {
  return {
    info: { id: 'deepseek', label: 'DeepSeek 官方 TTS（stella / tide）', side: 'server' },
    async speak(text, options, utterance) {
      const cfg = config()
      const result = await synthesizeDeepseek(text, {
        apiKey: await resolveDeepseekKey(ctx, cfg.deepseekApiKey),
        voiceId: resolveVoice(options.voice, cfg.deepseekVoice, ''),
        ...(cfg.deepseekBaseUrl !== '' ? { baseUrl: cfg.deepseekBaseUrl } : {}),
      })
      const saved = audio.save(result.audio, result.extension)
      const queued = queue.push({
        text,
        source: options.source ?? utterance.source,
        audioUrl: saved.url,
      })
      queued.durationMs = result.durationMs
      return {
        provider: 'deepseek',
        side: 'server',
        utterance: queued,
        audioUrl: saved.url,
        audioPath: audio.resolve(saved.file),
        durationMs: result.durationMs,
        note: '已合成 ' + String(Math.round(result.durationMs / 100) / 10) + 's 音频（' + cfg.deepseekVoice + '，' + String(result.chunks) + ' 段 / ' + String(result.billed) + ' 计费字符）',
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
  registry.register(deepseekProvider(ctx, queue, config, audio))

  /** 最近读过的文本（60 秒内去重：同一句话不重复念，自动朗读也不会盖掉 tts_speak） */
  const recentlySpoken: Array<{ text: string; at: number }> = []
  const normalizeSpoken = (text: string): string => text.replace(/[\s\p{P}\p{S}]/gu, '')
  const spokenBefore = (text: string): boolean => {
    const key = normalizeSpoken(text)
    if (key === '') return true
    const now = Date.now()
    for (let index = recentlySpoken.length - 1; index >= 0; index -= 1) {
      const item = recentlySpoken[index]
      if (item === undefined) continue
      if (now - item.at > 60_000) { recentlySpoken.splice(index, 1); continue }
      const seen = normalizeSpoken(item.text)
      // 完全相同，或一句包含另一句（模型「念一段」再给总结这种）都算重复
      if (seen === key || seen.includes(key) || key.includes(seen)) return true
    }
    return false
  }
  const markSpoken = (text: string): void => {
    recentlySpoken.push({ text, at: Date.now() })
    while (recentlySpoken.length > 10) recentlySpoken.shift()
  }

  /** 解析音频时长并写回 utterance（失败返回 undefined，不影响朗读） */
  const durationOf = async (path: string | undefined, utterance: Utterance): Promise<number | undefined> => {
    if (path === undefined) return undefined
    try {
      // DeepSeek 返回的是 WAV：直接读头算时长（mp3Duration 只认 mp3）
      if (/\.wav$/i.test(path)) {
        const header = readWavHeader(await readFile(path))
        if (header !== undefined) {
          const durationMs = pcmDurationMs(header.dataLength, header.sampleRate || 24000)
          utterance.durationMs = durationMs
          return durationMs
        }
      }
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
    const trimmed = sanitizeForSpeech(text)
    if (trimmed === '') throw new Error('要念的内容是空的（清洗后没有可读文本）')
    const clipped = trimmed.length > config().maxChars ? trimmed.slice(0, config().maxChars) + '…' : trimmed
    const provider = registry.get(config().provider)
    if (provider === undefined) {
      throw new Error('没有这个 TTS 引擎：' + config().provider + '（可选：' + registry.list().map(item => item.id).join('/') + '）')
    }
    // 逐句流水线：每句单独合成、单独入队。
    // 第一句合完就入队（客户端立刻开播），后面的句子在播放期间继续合成；
    // 长回复不必等整段合成完才开始出声（2026-11-18 参考 dsh-her 的 SpeechQueue）。
    const sentences = splitSentences(clipped)
    let result: SpeakResult | undefined
    if (sentences.length <= 1) {
      const placeholder: Utterance = { seq: 0, text: clipped, source: options.source ?? 'agent', createdAt: Date.now() }
      result = await provider.speak(clipped, options, placeholder)
      if (options.sessionId !== undefined) result.utterance.sessionId = options.sessionId
      const durationMs = await durationOf(result.audioPath, result.utterance)
      if (durationMs !== undefined) result.durationMs = durationMs
    } else {
      for (const sentence of sentences) {
        const placeholder: Utterance = { seq: 0, text: sentence, source: options.source ?? 'agent', createdAt: Date.now() }
        const piece = await provider.speak(sentence, options, placeholder)
        if (options.sessionId !== undefined) piece.utterance.sessionId = options.sessionId
        const durationMs = await durationOf(piece.audioPath, piece.utterance)
        if (durationMs !== undefined) piece.durationMs = durationMs
        if (result === undefined) result = piece
      }
    }
    if (result === undefined) throw new Error('合成没有产出结果')
    markSpoken(clipped)
    log('info', '朗读 ' + String(result.utterance.seq) + '：' + result.provider + ' ← ' + clipped.slice(0, 30)
      + (result.durationMs === undefined ? '' : '（' + (result.durationMs / 1000).toFixed(1) + 's）'))
    return result
  }

  /** 只合成不入队：给 QQ 语音这类"自己拿文件去发"的消费者 */
  const synthesize = async (text: string, options: SpeakOptions = {}): Promise<{ path: string; url: string; provider: string; durationMs?: number }> => {
    const trimmed = sanitizeForSpeech(text)
    if (trimmed === '') throw new Error('要念的内容是空的（清洗后没有可读文本）')
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
  const transcribe = async (path: string, options: { language?: string } = {}): Promise<{ text: string; elapsedMs: number; provider: 'volc' | 'deepseek' }> => {
    const cfg = config()
    if (!cfg.asrEnabled) throw new Error('语音识别已关闭（设置页 asrEnabled）')
    if (cfg.asrProvider === 'deepseek') {
      const apiKey = await resolveDeepseekKey(ctx, cfg.deepseekApiKey)
      if (apiKey === '') throw new Error('DeepSeek 语音识别需要 API Key（DSH 凭据 DEEPSEEK_API_KEY / 设置页 deepseekApiKey）')
      const result = await transcribeDeepseek(path, {
        apiKey,
        ...(cfg.deepseekBaseUrl !== '' ? { baseUrl: cfg.deepseekBaseUrl } : {}),
        chunkSeconds: 110,
        ...(cfg.asrFfmpegPath.trim() !== '' ? { ffmpegPath: cfg.asrFfmpegPath.trim() } : {}),
        log,
      })
      log('info', '语音识别完成（deepseek）：' + result.text.slice(0, 40) + '（' + String(result.elapsedMs) + 'ms / ' + String(result.chunks) + ' 段）')
      return { text: result.text, elapsedMs: result.elapsedMs, provider: 'deepseek' }
    }
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
   * - 只认 assistant/message；**带工具调用但含文本的回复也念**（2026-11-17 改）
   * - 同一会话 900ms 内的多条合并，只念最后一条（过程性文字照念）
   * - 清洗后没有汉字（纯英文一句）→ 跳过
   * - 跳过 autoReadSkipPrefix（默认 napcat-，QQ 那边自己发语音，不重复）
   */
  /**
   * 自动朗读诊断日志：把收到的 assistant/message 事件形状与决策写进
   * `$DSH_HOME/dsh-tts/autoread-probe.log`（最多保留最近 200 行，超出从头截断）。
   * 用途：宿主事件结构变化时，能直接看到"到底有没有收到事件、文本抽出来是什么"。
   */
  const probePath = join(homedir(), '.dsh', 'dsh-tts', 'autoread-probe.log')
  const probe = (line: string): void => {
    void (async () => {
      try {
        const entry = new Date().toISOString() + ' ' + line + '\n'
        let prev = ''
        try { prev = await readFile(probePath, 'utf8') } catch { /* 首次没有文件 */ }
        const lines = (prev + entry).split('\n').filter(Boolean)
        const kept = lines.slice(-400).join('\n') + '\n'
        await appendFile(probePath, '')
        const { writeFile } = await import('node:fs/promises')
        await writeFile(probePath, kept, 'utf8')
      } catch { /* 诊断失败不影响朗读 */ }
    })()
  }

  let autoReadTimer: ReturnType<typeof setTimeout> | undefined
  /** 已念过的消息 id（防止中间轮次的文本重复念） */
  const autoReadSeen = new Set<string>()
  /**
   * 「有人在的」会话：见过 user/message 的 session。
   * 子智能体、记忆工具、定时任务等内部会话不会收到 user/message，
   * 它们的 assistant 输出不该被念出来（2026-11-17 用户反馈：子智能体/记忆结果也被读了）。
   */
  const humanSessions = new Set<string>()
  /**
   * 当前聚焦的人机会话：只有它的回复会被朗读（用户 2026-11-17 要求「聚焦的当前会话」）。
   * 判定依据 = 最近一次真人 user/message 所属的会话；切换会话但不发消息时无法感知，属已知限制。
   */
  let activeHumanSession = ''
  /**
   * 每个会话「当前这轮由谁触发」：human = 真人发的消息；delegated = mnemon / 子智能体 / 工具注入。
   * mnemon 会在会话里注入 user/message（source.kind=dsh-mnemon）触发一轮"记忆整理/检查点"，
   * 那一轮的 assistant 回复 source 仍是 model，光看消息来源拦不住（2026-11-18 实测日志证据）。
   */
  const turnOrigin = new Map<string, 'human' | 'delegated'>()
  const autoReadPending = new Map<string, string>()
  const autoReadFlush = (): void => {
    autoReadTimer = undefined
    for (const [sessionId, rawText] of autoReadPending) {
      autoReadPending.delete(sessionId)
      // 自动朗读专用预处理：丢代码块、清洗 Markdown；清洗后为空（纯代码/纯表格回复）就不念。
      // 长度门禁：清洗后仍超过 maxChars×2 视为长文（多半是在念技术细节），跳过；
      // ② 与 ③ 只影响自动朗读，tts_speak / napcat 那两条显式路径保持原样。
      let text = rawText
      {
        const cleaned = sanitizeForSpeech(rawText).trim()
        if (cleaned === '') {
          log('debug', '自动朗读跳过（清洗后为空，多半是纯代码/表格）')
          continue
        }
        if (cleaned.length > config().maxChars * 2) {
          log('debug', '自动朗读跳过（清洗后 ' + cleaned.length + ' 字，超过上限 ' + config().maxChars * 2 + '）')
          continue
        }
        text = cleaned
      }
      if (text.trim() === '') continue
      // 60 秒内同义文本已经念过（比如模型刚 tts_speak 过）→ 不重复念
      if (spokenBefore(text)) {
        log('debug', '自动朗读跳过（刚念过）: ' + text.slice(0, 24))
        continue
      }
      probe('  → 朗读 len=' + text.length)
      void speak(text, { source: 'autoread', sessionId }).catch((error: unknown) => {
        log('debug', '自动朗读失败（' + sessionId + '）: ' + (error instanceof Error ? error.message : String(error)))
      })
    }
  }
  const onSessionEvent = (session: unknown, event: unknown): void => {
    const eventType = String((event as { type?: unknown }).type)
    // 只记与朗读相关的少数事件，其余（job/registered、step/* …）不落盘，避免刷掉有效记录
    const interesting = eventType === 'assistant/message' || eventType === 'user/message' || eventType === 'turn/end'
    if (interesting) probe('收到事件 type=' + eventType)
    if (!config().autoRead) return
    const sessionId = String((session as { header?: { id?: unknown }; id?: unknown }).header?.id
      ?? (session as { id?: unknown }).id ?? '')
    if (eventType === 'user/message') {
      // 子智能体的会话也会收到一条 user/message（就是派活用的 prompt），
      // 所以不能"见过 user/message 就算人类会话"。只有来源是真人（source.kind === 'user'
      // 或缺省）才登记；子智能体/工具派发的 prompt 来源不是 user（2026-11-17 用户反馈）。
      const src = (((event as { data?: { source?: unknown } }).data ?? {}) as { source?: { kind?: unknown } }).source
      const kind = typeof (src as { kind?: unknown })?.kind === 'string' ? String((src as { kind?: string }).kind) : ''
      probe('  user/message source.kind=' + (kind === '' ? '(none)' : kind))
      // 用「排除法」而不是白名单：真人来源在各宿主可能叫 user / web / im …，
      // 但派活来源一定带 subagent / agent / tool / mnemon / job 这类字样。
      // 会话 id 也做一次过滤：mnemon 的审查会话是 mnemon-review-v1-<hex>，
      // 它的 user/message 来源可能没有 kind（实测被当成人类会话，导致那一轮被朗读）
      const byId = /mnemon|subagent|review|delegate|child|task-/i.test(sessionId)
      const delegated = byId || /subagent|agent|tool|mnemon|job|task|delegate/i.test(kind)
      if (sessionId !== '') turnOrigin.set(sessionId, delegated ? 'delegated' : 'human')
      if (sessionId !== '' && !delegated) {
        humanSessions.add(sessionId)
        if (activeHumanSession !== '' && activeHumanSession !== sessionId) {
          // 切会话：旧会话还没播的句子丢掉，避免"看着新会话、耳朵里还是旧会话"
          const dropped = queue.dropWhere((u) => u.sessionId !== undefined && u.sessionId !== sessionId)
          if (dropped > 0) probe('  → 切会话，丢弃旧会话待播 ' + String(dropped) + ' 条')
        }
        activeHumanSession = sessionId
        probe('  → 当前聚焦会话=' + sessionId.slice(0, 24))
      } else if (delegated) {
        probe('  → 本轮由 ' + kind + ' 触发，后续回复不念')
      }
      return
    }
    if (eventType !== 'assistant/message') return
    // 只念人类会话：子智能体 / 记忆工具 / 定时任务自己的会话一律跳过
    if (sessionId === '' || !humanSessions.has(sessionId)) {
      probe('  → 跳过（非人类会话）session=' + sessionId.slice(0, 24))
      return
    }
    // 只念聚焦会话：别的会话正在跑也不念（避免两个会话的声音互相干扰）
    if (activeHumanSession !== '' && sessionId !== activeHumanSession) {
      probe('  → 跳过（非聚焦会话）session=' + sessionId.slice(0, 24))
      return
    }
    // QQ 通道的会话固定跳过：那边由 napcat 自己发语音，这里再念一遍就是重复
    if (sessionId.startsWith('napcat-')) return
    const payload = ((event as { payload?: unknown }).payload ?? (event as { data?: unknown }).data ?? {}) as Record<string, unknown>
    const message = (payload.message ?? payload) as { content?: unknown; id?: unknown; source?: unknown }
    // 轮次来源过滤：这轮如果是 mnemon / 子智能体注入触发的，整轮都不念
    if (turnOrigin.get(sessionId) === 'delegated') {
      probe('  → 跳过（本轮由非真人触发）')
      return
    }
    // 消息来源过滤：子智能体 / 记忆工具 / 工具回灌的 assistant 消息不念
    const rawSource = (message as { source?: unknown }).source
    const sourceKind = typeof (rawSource as { kind?: unknown })?.kind === 'string'
      ? String((rawSource as { kind?: string }).kind)
      : ''
    probe('  source=' + (sourceKind === '' ? '(none)' : sourceKind)
      + ' raw=' + JSON.stringify(rawSource ?? null).slice(0, 80))
    if (/subagent|agent|tool|mnemon|memory|job|task|delegate/i.test(sourceKind)) {
      probe('  → 跳过（来源=' + sourceKind + '）')
      return
    }
    const content = message.content
    probe('  dataKeys=' + Object.keys(((event as { data?: object }).data) ?? {}).join(',')
      + ' msgKeys=' + Object.keys(message as object).join(',')
      + ' contentIsArray=' + String(Array.isArray(content)))
    if (!Array.isArray(content)) return
    const blocks = content as Array<{
      type?: string
      text?: string
      thinking?: boolean
      reasoning?: boolean
      channel?: string
    }>
    // 只念「真正的回复正文」，思考/推理内容一律不念：
    // - 只认 type === 'text'
    // - 再排除带 thinking/reasoning 标记、或 channel 标注为思考的块
    //   （模型有时把推理塞进 text 块；2026-11-17 用户反馈：不该读那种"思考"）
    const isReason = (block: { type?: string; thinking?: boolean; reasoning?: boolean; channel?: string }): boolean =>
      block.type !== 'text'
      || block.thinking === true
      || block.reasoning === true
      || (typeof block.channel === 'string' && /reason|think/i.test(block.channel))
    const text = blocks.filter(block => !isReason(block)).map(block => String(block.text ?? '')).join('').trim()
    probe('  blockTypes=' + blocks.map(block => String(block.type)).join(',')
      + ' 排除块=' + blocks.filter(isReason).length + ' textLen=' + text.length)
    if (text === '') return
    // 按消息 id 去重：中间轮次的文本不会因为不再被跳过而重复念。
    // 宿主没给 id 时退回「同文本 60 秒内只念一次」（spokenBefore 已有）。
    const rawId = (message as { id?: unknown }).id ?? (payload as { id?: unknown }).id ?? (event as { id?: unknown }).id
    const msgId = typeof rawId === 'string' && rawId !== '' ? sessionId + '#' + rawId : ''
    if (msgId !== '') {
      if (autoReadSeen.has(msgId)) return
      autoReadSeen.add(msgId)
      if (autoReadSeen.size > 200) {
        // 简单限量：丢掉最早的一批（Set 保持插入顺序）
        const drop = autoReadSeen.size - 200
        let i = 0
        for (const key of autoReadSeen) {
          if (i++ >= drop) break
          autoReadSeen.delete(key)
        }
      }
    }
    probe('  → 入队 session=' + sessionId.slice(0, 12) + ' len=' + text.length
      + ' msgId=' + (msgId === '' ? '(none)' : msgId.slice(-12)) + ' head=' + text.slice(0, 18))
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
          const request = req as {
            url?: string
            method?: string
            on?: (event: string, cb: (chunk: unknown) => void) => void
          }
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
          if (url.pathname === '/dsh-tts/api/client-report' && request.method === 'POST' && typeof request.on === 'function') {
            // 客户端自报状态：排查「服务端说朗读了、浏览器却没声音」时，这一条能直接定位
            // 是客户端没跑（旧 bundle）、没拉到队列、还是 audio.play() 被拦。
            let body = ''
            request.on('data', (chunk: unknown) => { body += String(chunk) })
            request.on('end', () => {
              probe('客户端: ' + body.slice(0, 300))
              json({ ok: true })
            })
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
                json({ url: made.url, provider: made.provider, text, durationMs: made.durationMs, size: (() => { try { return readFileSync(audio.resolve(made.url.split('/').pop() ?? '') ?? '').length } catch { return 0 } })() })
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
