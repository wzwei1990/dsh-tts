/**
 * 火山方舟 TTS 引擎（2026-11-05，按官方 Agent Plan 文档的 **v3** 接口实现）。
 *
 * 官方 HTTP 单流接口（一次发文本、流式返回音频片段）：
 *   POST https://openspeech.bytedance.com/api/v3/plan/tts/unidirectional
 *   headers:
 *     X-Api-Key: <专属 API Key>
 *     X-Api-Resource-Id: seed-tts-2.0        （豆包语音合成模型 2.0）
 *     X-Control-Require-Usage-Tokens-Return: *
 *     Content-Type: application/json
 *   body:
 *     { req_params: { text, speaker: "zh_female_vv_uranus_bigtts",
 *                     audio_params: { format: "mp3", sample_rate: 24000 } } }
 *   响应：**流式 JSON 行**，每行 { code, data: <base64 音频>, message }
 *          code === 0 → 追加音频；code === 20000000 → 结束；其它 >0 → 报错
 *
 * 文档：https://docs.volcengine.com/docs/ark/agent-plan-personal-voice-model
 */
export interface VolcOptions {
  /** 专属 API Key（火山方舟控制台） */
  apiKey: string
  /** 资源 id，默认 seed-tts-2.0 */
  resourceId?: string
  /** 音色 speaker，例如 zh_female_vv_uranus_bigtts */
  speaker?: string
  /** 输出格式：mp3 / wav / pcm */
  format?: string
  /** 采样率 */
  sampleRate?: number
  /** 接口地址（留空=官方） */
  endpoint?: string
  timeoutMs?: number
}

export interface VolcResult {
  audio: Buffer
  mime: string
  extension: string
}

const DEFAULT_ENDPOINT = 'https://openspeech.bytedance.com/api/v3/plan/tts/unidirectional'
const END_CODE = 20000000

function mimeOf(format: string): { mime: string; extension: string } {
  const lower = format.toLowerCase()
  if (lower === 'wav') return { mime: 'audio/wav', extension: 'wav' }
  if (lower === 'pcm') return { mime: 'audio/pcm', extension: 'pcm' }
  return { mime: 'audio/mpeg', extension: 'mp3' }
}

export async function synthesizeVolc(text: string, options: VolcOptions): Promise<VolcResult> {
  const trimmed = text.trim()
  if (trimmed === '') throw new Error('要念的内容是空的')
  if (options.apiKey.trim() === '') {
    throw new Error('火山方舟 TTS 需要 API Key（设置页 volcApiKey，方舟控制台的「专属 API Key」）')
  }
  const endpoint = options.endpoint !== undefined && options.endpoint !== '' ? options.endpoint : DEFAULT_ENDPOINT
  const format = (options.format ?? 'mp3').toLowerCase()
  const body = {
    req_params: {
      text: trimmed,
      speaker: (options.speaker ?? 'zh_female_vv_uranus_bigtts').trim(),
      audio_params: {
        format,
        sample_rate: options.sampleRate ?? 24000,
      },
    },
  }

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'X-Api-Key': options.apiKey.trim(),
      'X-Api-Resource-Id': (options.resourceId ?? 'seed-tts-2.0').trim(),
      'X-Control-Require-Usage-Tokens-Return': '*',
      'Content-Type': 'application/json',
      Connection: 'keep-alive',
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(options.timeoutMs ?? 60_000),
  })

  if (!response.ok) {
    const detail = (await response.text()).slice(0, 200)
    throw new Error('火山方舟 TTS HTTP ' + String(response.status) + '：' + detail)
  }
  if (response.body === null) throw new Error('火山方舟 TTS 没有响应体')

  // 流式 JSON 行解析：每行一个 { code, data, message }
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  const chunks: Buffer[] = []
  let pending = ''
  let finished = false
  let lastError = ''

  const handleLine = (line: string): void => {
    const text = line.trim()
    if (text === '') return
    let parsed: { code?: number; message?: string; data?: string }
    try {
      parsed = JSON.parse(text) as { code?: number; message?: string; data?: string }
    } catch {
      return // 不是 JSON 行就跳过（有些网关会插空行/心跳）
    }
    const code = parsed.code ?? 0
    if (code === END_CODE) { finished = true; return }
    if (code > 0) { lastError = 'code ' + String(code) + ' ' + (parsed.message ?? ''); return }
    if (typeof parsed.data === 'string' && parsed.data !== '') {
      chunks.push(Buffer.from(parsed.data, 'base64'))
    }
  }

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    pending += decoder.decode(value, { stream: true })
    let newline = pending.indexOf('\n')
    while (newline >= 0) {
      handleLine(pending.slice(0, newline))
      pending = pending.slice(newline + 1)
      newline = pending.indexOf('\n')
    }
    if (finished) break
  }
  if (pending.trim() !== '') handleLine(pending)
  try { await reader.cancel() } catch { /* 忽略 */ }

  const audio = Buffer.concat(chunks)
  if (audio.length === 0) {
    throw new Error('火山方舟 TTS 没有返回音频' + (lastError !== '' ? '（' + lastError + '）' : '') + '：检查 API Key / 资源 id / speaker')
  }
  const { mime, extension } = mimeOf(format)
  return { audio, mime, extension }
}
