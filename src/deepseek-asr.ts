/**
 * DeepSeek 官方语音识别（2026-11-16 接入）。
 *
 * 官方文档：https://api-docs.deepseek.com/zh-cn/guides/asr
 *   POST https://api.deepseek.com/v1/tools/asr   （multipart/form-data，字段名 file）
 *   输入：16 位 PCM WAV 或 Ogg Opus；WAV 采样率 8k/16k/22.05k/24k/32k/44.1k/48k；单/双声道（**只识别左声道**）
 *   限制：单文件 ≤120 秒、≤8 MiB、上传 10 分钟内完成；**不支持流式**
 *   输出：{ request_id, text, duration_ms }（**无时间戳、无说话人**）
 *   错误：400（格式不对）/408（上传超时）/413（>8MiB）/429（并发超限）/503/504
 *   计费：按音频时长精确到秒（不足 1 秒按 1 秒）
 *
 * 我们的做法：
 *   ① 先用 ffmpeg 把任意输入（amr/silk/mp3/…）转成 16k 单声道 16bit WAV
 *   ② 超过 chunkSeconds（默认 110s，留余量）就按 PCM 切片，每片单独上传后拼接文本
 *   ③ 每片都远小于 8 MiB（110s × 32KB/s ≈ 3.5MB）
 */
import { spawn } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { pcmToWav, readWavHeader } from './deepseek-tts.js'

export const DEEPSEEK_ASR_URL_DEFAULT = 'https://api.deepseek.com/v1/tools/asr'
export const ASR_TARGET_SAMPLE_RATE = 16_000
export const ASR_MAX_SECONDS = 120
export const ASR_MAX_BYTES = 8 * 1024 * 1024

export interface DeepseekAsrOptions {
  apiKey: string
  baseUrl?: string
  /** 单段秒数（默认 110，给 120 秒硬限留余量） */
  chunkSeconds?: number
  /** ffmpeg 可执行文件（默认 PATH 里的 ffmpeg） */
  ffmpegPath?: string
  timeoutMs?: number
  fetchImpl?: typeof fetch
  log?: (level: 'debug' | 'info' | 'warn', message: string) => void
}

export interface DeepseekAsrResult {
  text: string
  /** 官方返回的时长（毫秒），多段时为最后一段的 duration_ms；总时长见 durationMsTotal */
  durationMs: number
  durationMsTotal: number
  requestIds: string[]
  chunks: number
  elapsedMs: number
  provider: 'deepseek'
}

/** 用 ffmpeg 把任意音频转成 16k / 单声道 / 16bit WAV（整段返回 Buffer）。 */
export async function convertToWav(
  inputPath: string,
  ffmpegPath = 'ffmpeg',
  sampleRate = ASR_TARGET_SAMPLE_RATE,
): Promise<Buffer> {
  return await new Promise<Buffer>((resolve, reject) => {
    const child = spawn(ffmpegPath, [
      '-hide_banner', '-loglevel', 'error', '-nostdin',
      '-i', inputPath,
      '-ac', '1', '-ar', String(sampleRate), '-acodec', 'pcm_s16le',
      '-f', 'wav', 'pipe:1',
    ], { stdio: ['ignore', 'pipe', 'pipe'] })
    const out: Buffer[] = []
    const err: Buffer[] = []
    child.stdout.on('data', (chunk: Buffer) => out.push(chunk))
    child.stderr.on('data', (chunk: Buffer) => err.push(chunk))
    child.on('error', (error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') {
        reject(new Error('语音识别需要 ffmpeg（转 16k WAV）；没找到 ' + ffmpegPath + '，请在设置页配置或装到 PATH'))
      } else reject(error)
    })
    child.on('close', (code) => {
      if (code === 0) resolve(Buffer.concat(out))
      else reject(new Error('ffmpeg 转码失败（退出码 ' + String(code) + '）：' + Buffer.concat(err).toString('utf8').slice(0, 300)))
    })
  })
}

/**
 * 把一段 16bit 单声道 WAV 按最大秒数切成多段 WAV（每段都带合法头）。
 * 不是 WAV（或找不到 data 块）时原样返回单段，交给服务端报错。
 */
export function splitWav(buffer: Buffer, maxSeconds: number, fallbackSampleRate = ASR_TARGET_SAMPLE_RATE): Buffer[] {
  const header = readWavHeader(buffer)
  if (header === undefined) return [buffer]
  const sampleRate = header.sampleRate > 0 ? header.sampleRate : fallbackSampleRate
  const bytesPerSecond = sampleRate * header.channels * 2
  const maxBytes = Math.floor(bytesPerSecond * maxSeconds)
  const data = buffer.subarray(header.dataOffset, header.dataOffset + header.dataLength)
  if (data.length <= maxBytes) return [buffer]
  const parts: Buffer[] = []
  for (let offset = 0; offset < data.length; offset += maxBytes) {
    const slice = data.subarray(offset, Math.min(offset + maxBytes, data.length))
    parts.push(pcmToWav(slice, sampleRate, header.channels))
  }
  return parts
}

function statusHint(status: number): string {
  if (status === 400) return '音频不是 16 位 PCM WAV / Ogg Opus，或缺少 file 字段'
  if (status === 408) return '上传超时（10 分钟内没传完）'
  if (status === 413) return '文件超过 8 MiB'
  if (status === 429) return '账号并发超限'
  if (status === 503) return '服务繁忙，稍后重试'
  if (status === 504) return '识别超时'
  return 'HTTP ' + String(status)
}

async function transcribeChunk(
  wav: Buffer,
  options: DeepseekAsrOptions,
): Promise<{ text: string; durationMs: number; requestId: string }> {
  if (wav.length > ASR_MAX_BYTES) throw new Error('单段音频超过 8 MiB（请调小 chunkSeconds）')
  const fetchImpl = options.fetchImpl ?? fetch
  const baseUrl = (options.baseUrl ?? 'https://api.deepseek.com').replace(/\/+$/, '')
  const url = baseUrl + '/v1/tools/asr'
  const form = new FormData()
  form.append('file', new Blob([new Uint8Array(wav)], { type: 'audio/wav' }), 'audio.wav')
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 120_000)
  try {
    const response = await fetchImpl(url, {
      method: 'POST',
      signal: controller.signal,
      headers: { authorization: 'Bearer ' + options.apiKey.trim() },
      body: form,
    })
    if (!response.ok) throw new Error('DeepSeek ASR 失败（' + statusHint(response.status) + '）')
    const body = (await response.json()) as { text?: unknown; duration_ms?: unknown; request_id?: unknown }
    return {
      text: typeof body.text === 'string' ? body.text.trim() : '',
      durationMs: typeof body.duration_ms === 'number' ? body.duration_ms : 0,
      requestId: typeof body.request_id === 'string' ? body.request_id : '',
    }
  } finally {
    clearTimeout(timer)
  }
}

/** 转写一段本地音频（任意格式，内部用 ffmpeg 转码）。 */
export async function transcribeDeepseek(
  inputPath: string,
  options: DeepseekAsrOptions,
): Promise<DeepseekAsrResult> {
  const started = Date.now()
  const apiKey = options.apiKey.trim()
  if (apiKey === '') throw new Error('DeepSeek ASR 需要 API Key（设置页 deepseekApiKey 或环境变量 DEEPSEEK_API_KEY）')
  const chunkSeconds = Math.min(ASR_MAX_SECONDS, Math.max(10, options.chunkSeconds ?? 110))
  // 允许直接传已是 wav 的文件，省一次转码
  let wav: Buffer
  if (/\.wav$/i.test(inputPath)) {
    try {
      const raw = await readFile(inputPath)
      wav = readWavHeader(raw) !== undefined ? raw : await convertToWav(inputPath, options.ffmpegPath)
    } catch {
      wav = await convertToWav(inputPath, options.ffmpegPath)
    }
  } else {
    wav = await convertToWav(inputPath, options.ffmpegPath)
  }
  const parts = splitWav(wav, chunkSeconds)
  const texts: string[] = []
  const requestIds: string[] = []
  let lastDuration = 0
  let totalDuration = 0
  parts.forEach(() => undefined)
  for (const part of parts) {
    const result = await transcribeChunk(part, options)
    if (result.text !== '') texts.push(result.text)
    if (result.requestId !== '') requestIds.push(result.requestId)
    lastDuration = result.durationMs
    totalDuration += result.durationMs
  }
  const elapsedMs = Date.now() - started
  options.log?.('info', 'DeepSeek ASR 完成：' + String(parts.length) + ' 段 / ' + String(Math.round(totalDuration / 1000)) + ' 秒 / ' + String(elapsedMs) + 'ms')
  return {
    text: texts.join(''),
    durationMs: lastDuration,
    durationMsTotal: totalDuration,
    requestIds,
    chunks: parts.length,
    elapsedMs,
    provider: 'deepseek',
  }
}
