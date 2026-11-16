/**
 * DeepSeek 官方语音合成（2026-11-16 接入）。
 *
 * 官方文档：https://api-docs.deepseek.com/zh-cn/guides/tts
 *   POST https://api.deepseek.com/v1/tools/tts
 *   body: { text, voice_id: 'stella'|'tide', format: 'wav'|'pcm', filter_markdown }
 *   限制：单请求 ≤1 万**计费字符**（中文按 2 计）、请求体 ≤64 KiB、最多 30 分钟音频
 *   输出：wav（默认）或 24 kHz / 16 bit / 单声道裸 PCM，边合成边流式返回
 *   音色只有两个：stella（女，默认）/ tide（男）；**不支持语速、情感、音色克隆**
 *   错误码：400（无可读文本/内容审核）/ 429（并发超限）/ 503（繁忙）/ 504（超时）
 *
 * 这里统一按 `format: 'pcm'` 分片请求，最后拼成**一个 WAV**：
 *   - 不引入 ffmpeg 依赖（WAV 头自己写）
 *   - 时长可直接由 PCM 字节数算出，交给现有 durationOf 之外的新路径使用
 */

export const DEEPSEEK_TTS_URL = 'https://api.deepseek.com/v1/tools/tts'
export const DEEPSEEK_SAMPLE_RATE = 24_000
export const MAX_BILLED_CHARS = 10_000
export const MAX_BODY_BYTES = 64 * 1024
const BYTES_PER_SAMPLE = 2

export interface DeepseekTtsOptions {
  apiKey: string
  voiceId?: string
  baseUrl?: string
  timeoutMs?: number
  /** 单次请求的计费字符上限（默认 10000） */
  maxBilledChars?: number
  /** 单次请求体积上限（默认 64 KiB，留出 JSON 包装余量） */
  maxBodyBytes?: number
  fetchImpl?: typeof fetch
}

export interface DeepseekTtsResult {
  audio: Buffer
  mime: string
  extension: string
  durationMs: number
  /** 实际切成几段请求 */
  chunks: number
  /** 计费字符数（中文按 2 计） */
  billed: number
}

/** 计费字符：中日韩统一表意文字（含扩展 A、兼容区）按 2 计，其它（字母/数字/空格/标点）按 1。 */
export function billedChars(text: string): number {
  let total = 0
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0
    const cjk =
      (code >= 0x3000 && code <= 0x303f) || // CJK 标点（按中文计）
      (code >= 0x3040 && code <= 0x30ff) || // 日文假名
      (code >= 0x3400 && code <= 0x4dbf) || // 扩展 A
      (code >= 0x4e00 && code <= 0x9fff) || // 基本区
      (code >= 0xf900 && code <= 0xfaff) || // 兼容表意
      (code >= 0xff00 && code <= 0xffef)    // 全角
    total += cjk ? 2 : 1
  }
  return total
}

/** 按句末标点切句（保留标点），用于超限时拆分。 */
function sentences(text: string): string[] {
  const out: string[] = []
  let buffer = ''
  for (const ch of text) {
    buffer += ch
    if (/[。！？!?；;\n]/.test(ch)) {
      if (buffer.trim() !== '') out.push(buffer)
      buffer = ''
    }
  }
  if (buffer.trim() !== '') out.push(buffer)
  return out
}

/**
 * 把长文本切成若干段，每段都不超过「计费字符上限」与「请求体上限」。
 * 单句本身超限时按字符硬切（不切坏代理对）。
 */
export function splitForTts(
  text: string,
  limit: number = MAX_BILLED_CHARS,
  maxBytes: number = MAX_BODY_BYTES,
): string[] {
  const trimmed = text.trim()
  if (trimmed === '') return []
  const fits = (value: string): boolean => billedChars(value) <= limit && Buffer.byteLength(value, 'utf8') + 64 <= maxBytes
  if (fits(trimmed)) return [trimmed]
  const parts: string[] = []
  let current = ''
  for (const sentence of sentences(trimmed)) {
    if (fits(sentence)) {
      if (fits(current + sentence)) current += sentence
      else {
        if (current !== '') parts.push(current)
        current = sentence
      }
      continue
    }
    // 单句超限：先把 current 收掉，再按字符硬切
    if (current !== '') {
      parts.push(current)
      current = ''
    }
    let piece = ''
    for (const ch of sentence) {
      if (!fits(piece + ch)) {
        if (piece !== '') parts.push(piece)
        piece = ch
      } else piece += ch
    }
    if (piece !== '') parts.push(piece)
  }
  if (current !== '') parts.push(current)
  return parts.filter(part => part.trim() !== '')
}

/** 24kHz 16bit 单声道 PCM 的字节数 → 毫秒 */
export function pcmDurationMs(bytes: number, sampleRate = DEEPSEEK_SAMPLE_RATE): number {
  if (bytes <= 0) return 0
  return Math.round((bytes / (sampleRate * BYTES_PER_SAMPLE)) * 1000)
}

/** 裸 PCM 加 44 字节 WAV 头（RIFF/WAVE/fmt/data），浏览器与大多数播放器可直接播。 */
export function pcmToWav(pcm: Buffer, sampleRate = DEEPSEEK_SAMPLE_RATE, channels = 1): Buffer {
  const byteRate = sampleRate * channels * BYTES_PER_SAMPLE
  const header = Buffer.alloc(44)
  header.write('RIFF', 0, 'ascii')
  header.writeUInt32LE(36 + pcm.length, 4)
  header.write('WAVE', 8, 'ascii')
  header.write('fmt ', 12, 'ascii')
  header.writeUInt32LE(16, 16)                       // fmt 块大小
  header.writeUInt16LE(1, 20)                        // PCM
  header.writeUInt16LE(channels, 22)
  header.writeUInt32LE(sampleRate, 24)
  header.writeUInt32LE(byteRate, 28)
  header.writeUInt16LE(channels * BYTES_PER_SAMPLE, 32) // block align
  header.writeUInt16LE(16, 34)                       // 位深
  header.write('data', 36, 'ascii')
  header.writeUInt32LE(pcm.length, 40)
  return Buffer.concat([header, pcm])
}

/** 读 WAV 头，返回 data 段起点与采样率（只支持标准 44 字节头 / 带扩展 fmt 的常见写法）。 */
export function readWavHeader(buffer: Buffer): { dataOffset: number; dataLength: number; sampleRate: number; channels: number } | undefined {
  if (buffer.length < 44) return undefined
  if (buffer.toString('ascii', 0, 4) !== 'RIFF' || buffer.toString('ascii', 8, 12) !== 'WAVE') return undefined
  let offset = 12
  let sampleRate = 0
  let channels = 1
  while (offset + 8 <= buffer.length) {
    const id = buffer.toString('ascii', offset, offset + 4)
    const size = buffer.readUInt32LE(offset + 4)
    if (id === 'fmt ' && offset + 8 + 16 <= buffer.length) {
      channels = buffer.readUInt16LE(offset + 10)
      sampleRate = buffer.readUInt32LE(offset + 12)
    }
    if (id === 'data') {
      return { dataOffset: offset + 8, dataLength: Math.min(size, buffer.length - (offset + 8)), sampleRate, channels }
    }
    offset += 8 + size + (size % 2) // 块按偶数对齐
  }
  return undefined
}

function statusHint(status: number): string {
  if (status === 400) return '文本为空或未通过内容审核'
  if (status === 429) return '账号并发超限'
  if (status === 503) return '服务繁忙，稍后重试'
  if (status === 504) return '合成超时'
  return 'HTTP ' + String(status)
}

/**
 * 合成一段文本 → 一个 WAV。超限自动分段，最后把 PCM 拼起来只写一次 WAV 头。
 * 任一失败直接抛错（调用方决定是否回落到 edge / volc）。
 */
export async function synthesizeDeepseek(
  text: string,
  options: DeepseekTtsOptions,
): Promise<DeepseekTtsResult> {
  const trimmed = text.trim()
  if (trimmed === '') throw new Error('要念的内容是空的')
  const apiKey = options.apiKey.trim()
  if (apiKey === '') throw new Error('DeepSeek TTS 需要 API Key（设置页 deepseekApiKey 或环境变量 DEEPSEEK_API_KEY）')
  const baseUrl = (options.baseUrl ?? 'https://api.deepseek.com').replace(/\/+$/, '')
  const url = baseUrl + '/v1/tools/tts'
  const fetchImpl = options.fetchImpl ?? fetch
  const voiceId = options.voiceId ?? 'stella'
  const chunks = splitForTts(trimmed, options.maxBilledChars ?? MAX_BILLED_CHARS, options.maxBodyBytes ?? MAX_BODY_BYTES)
  if (chunks.length === 0) throw new Error('要念的内容是空的')

  const pcmParts: Buffer[] = []
  for (const part of chunks) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 60_000)
    try {
      const response = await fetchImpl(url, {
        method: 'POST',
        signal: controller.signal,
        headers: { 'content-type': 'application/json', authorization: 'Bearer ' + apiKey },
        body: JSON.stringify({ text: part, voice_id: voiceId, format: 'pcm', filter_markdown: true }),
      })
      if (!response.ok) throw new Error('DeepSeek TTS 失败（' + statusHint(response.status) + '）')
      pcmParts.push(Buffer.from(await response.arrayBuffer()))
    } finally {
      clearTimeout(timer)
    }
  }
  const pcm = Buffer.concat(pcmParts)
  if (pcm.length === 0) throw new Error('DeepSeek TTS 返回了空音频')
  return {
    audio: pcmToWav(pcm),
    mime: 'audio/wav',
    extension: 'wav',
    durationMs: pcmDurationMs(pcm.length),
    chunks: chunks.length,
    billed: chunks.reduce((sum, part) => sum + billedChars(part), 0),
  }
}
