/**
 * Edge TTS 引擎（2026-11-05）。
 *
 * 免费、免 key，走 Edge 浏览器的"朗读"WebSocket 协议。
 * 微软 2025 年换过端点并加了反滥用签名，这里按当前可用形态实现（实测出声）：
 *   wss://api.msedgeservices.com/tts/cognitiveservices/websocket/v1
 *   ?Ocp-Apim-Subscription-Key=<TRUSTED>&Sec-MS-GEC=<签名>&Sec-MS-GEC-Version=1-155.0.4283.45&ConnectionId=<uuid>
 *
 * 签名 = SHA256( (floor(now/1000)+11644473600 向下取整到 300 秒) * 1e7 + TRUSTED ) 的大写十六进制。
 */
import { createHash, randomUUID } from 'node:crypto'

const TRUSTED_TOKEN = '6A5AA1D4EAFF4E9FB37E23D68491D6F4'
const SEC_MS_GEC_VERSION = '1-155.0.4283.45'
const WSS_BASE = 'wss://api.msedgeservices.com/tts/cognitiveservices/websocket/v1'
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/155.0.0.0 Safari/537.36 Edg/155.0.0.0'

export interface EdgeVoiceOptions {
  /** 音色名，如 zh-CN-XiaoxiaoNeural */
  voice?: string
  /** 语速百分比，如 +10% / -20% */
  ratePercent?: number
  /** 音高，单位 Hz，如 +20 / -10 */
  pitchHz?: number
  /** 音量百分比，如 +0% / +50% */
  volumePercent?: number
  timeoutMs?: number
}

export interface EdgeResult {
  audio: Buffer
  mime: string
  extension: string
}

/** Sec-MS-GEC 签名 */
export function secMsGec(nowMs = Date.now()): string {
  const ticks = Math.floor(nowMs / 1000) + 11644473600
  const rounded = ticks - (ticks % 300)
  return createHash('sha256').update(String(rounded * 10_000_000) + TRUSTED_TOKEN, 'utf8').digest('hex').toUpperCase()
}

function buildSynthesisUrl(): string {
  return WSS_BASE
    + '?Ocp-Apim-Subscription-Key=' + TRUSTED_TOKEN
    + '&Sec-MS-GEC=' + secMsGec()
    + '&Sec-MS-GEC-Version=' + SEC_MS_GEC_VERSION
    + '&ConnectionId=' + randomUUID().replace(/-/g, '')
}

function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

export function buildSsml(text: string, options: EdgeVoiceOptions = {}): string {
  const voice = options.voice !== undefined && options.voice !== '' ? options.voice : 'zh-CN-XiaoxiaoNeural'
  const lang = voice.split('-').slice(0, 2).join('-')
  const rate = (options.ratePercent ?? 0) >= 0 ? '+' + String(options.ratePercent ?? 0) : String(options.ratePercent ?? 0)
  const pitch = (options.pitchHz ?? 0) >= 0 ? '+' + String(options.pitchHz ?? 0) : String(options.pitchHz ?? 0)
  const volume = (options.volumePercent ?? 0) >= 0 ? '+' + String(options.volumePercent ?? 0) : String(options.volumePercent ?? 0)
  return '<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="' + lang + '">'
    + '<voice name="' + voice + '">'
    + '<prosody rate="' + rate + '%" pitch="' + pitch + 'Hz" volume="' + volume + '%">'
    + escapeXml(text)
    + '</prosody></voice></speak>'
}

/** 合成一句话（遇到 429 限流会重试两次） */
export async function synthesizeEdge(text: string, options: EdgeVoiceOptions = {}): Promise<EdgeResult> {
  const delays = [1500, 3000]
  let lastError: Error | undefined
  for (let attempt = 0; attempt <= delays.length; attempt += 1) {
    try {
      return await synthesizeOnce(text, options)
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error))
      const retryable = /429|握手被拒|超时/.test(lastError.message)
      const delay = delays[attempt]
      if (!retryable || delay === undefined) break
      await new Promise(resolve => setTimeout(resolve, delay))
    }
  }
  throw lastError ?? new Error('Edge TTS 失败')
}

async function synthesizeOnce(text: string, options: EdgeVoiceOptions = {}): Promise<EdgeResult> {
  const trimmed = text.trim()
  if (trimmed === '') throw new Error('要念的内容是空的')
  // ws 是可选依赖：没装就直接告诉用户怎么办
  let WebSocket: unknown
  try {
    const mod = await import('ws')
    WebSocket = (mod as { default?: unknown }).default ?? mod
  } catch {
    throw new Error('Edge TTS 需要依赖 ws（npm i ws）')
  }
  const timeoutMs = options.timeoutMs ?? 30_000
  return await new Promise<EdgeResult>((resolve, reject) => {
    const chunks: Buffer[] = []
    let settled = false
    const fail = (error: Error): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      try { socket.close() } catch { /* 忽略 */ }
      reject(error)
    }
    const timer = setTimeout(() => fail(new Error('Edge TTS 超时（' + String(timeoutMs) + 'ms）')), timeoutMs)
    const SocketCtor = WebSocket as new (url: string, options: { headers: Record<string, string> }) => {
      on: (event: string, handler: (...args: never[]) => void) => void
      send: (data: string) => void
      close: () => void
      terminate: () => void
    }
    const socket = new SocketCtor(buildSynthesisUrl(), {
      headers: {
        'User-Agent': UA,
        'Accept-Encoding': 'gzip, deflate, br, zstd',
        'Accept-Language': 'en-US,en;q=0.9',
        Cookie: 'MUID=' + randomUUID().replace(/-/g, '').toUpperCase(),
        Pragma: 'no-cache',
        'Cache-Control': 'no-cache',
        Origin: 'chrome-extension://jdiccldimpdaibmpdkjnbmckianbfold',
      },
    })

    socket.on('open', () => {
      const timestamp = new Date().toISOString()
      socket.send('X-Timestamp:' + timestamp + '\r\nContent-Type:application/json; charset=utf-8\r\nPath:speech.config\r\n\r\n'
        + JSON.stringify({ context: { synthesis: { audio: { metadataoptions: { sentenceBoundaryEnabled: false, wordBoundaryEnabled: false }, outputFormat: 'audio-24khz-48kbitrate-mono-mp3' } } } }))
      socket.send('X-RequestId:' + randomUUID().replace(/-/g, '')
        + '\r\nContent-Type:application/ssml+xml\r\nX-Timestamp:' + timestamp
        + '\r\nPath:ssml\r\n\r\n' + buildSsml(trimmed, options))
    })

    socket.on('message', ((data: unknown) => {
      const buffer = Buffer.isBuffer(data) ? data : Buffer.from(data as ArrayBuffer)
      const head = buffer.subarray(0, Math.min(400, buffer.length)).toString('utf8')
      if (process.env.DSH_TTS_DEBUG === '1') {
        console.log('[dsh-tts][edge] frame len=' + String(buffer.length) + ' head=' + JSON.stringify(head.slice(0, 120)))
      }
      if (head.includes('Path:turn.end')) {
        if (settled) return
        settled = true
        clearTimeout(timer)
        try { socket.close() } catch { /* 忽略 */ }
        const audio = Buffer.concat(chunks)
        if (audio.length === 0) {
          reject(new Error('Edge TTS 没有返回音频（可能是音色名不对或被限流）'))
          return
        }
        resolve({ audio, mime: 'audio/mpeg', extension: 'mp3' })
        return
      }
      // 音频二进制帧的格式：2 字节大端头长度 + 头部文本 + 音频数据
      // （头部里有 X-RequestId / Content-Type:audio/mpeg / Path:audio，且**没有** \r\n\r\n 分界）
      if (buffer.length > 4 && buffer[0] === 0) {
        const headerLength = buffer.readUInt16BE(0)
        if (headerLength > 0 && 2 + headerLength <= buffer.length) {
          const header = buffer.subarray(2, 2 + headerLength).toString('utf8')
          if (header.includes('Path:audio')) {
            chunks.push(buffer.subarray(2 + headerLength))
            return
          }
        }
      }
      const separator = buffer.indexOf('\r\n\r\n')
      if (separator >= 0 && head.includes('Path:audio')) {
        chunks.push(buffer.subarray(separator + 4))
        return
      }
      // 兜底：纯二进制帧（没有头部）
      if (!head.startsWith('X-RequestId') && !head.startsWith('X-Timestamp') && !head.includes('Path:')) {
        chunks.push(buffer)
      }
    }) as never)

    socket.on('unexpected-response', ((_request: unknown, response: { statusCode?: number }) => {
      fail(new Error('Edge TTS 握手被拒（HTTP ' + String(response.statusCode ?? '?') + '）：检查网络或稍后重试'))
    }) as never)
    socket.on('error', ((error: Error) => fail(new Error('Edge TTS 连接失败：' + error.message))) as never)
    socket.on('close', (() => {
      if (!settled) fail(new Error('Edge TTS 连接提前关闭'))
    }) as never)
  })
}
