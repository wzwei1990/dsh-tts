/**
 * DeepSeek TTS / ASR 单元测试（2026-11-16 接入官方语音接口时补）。
 * 只测纯逻辑与 mock HTTP，不真的打网络；ffmpeg 相关只测 WAV 切分。
 */
import test from 'node:test'
import assert from 'node:assert/strict'

const {
  billedChars,
  splitForTts,
  pcmToWav,
  readWavHeader,
  pcmDurationMs,
  synthesizeDeepseek,
  MAX_BILLED_CHARS,
} = await import('../lib/deepseek-tts.js')
const { splitWav, transcribeDeepseek } = await import('../lib/deepseek-asr.js')

test('计费字符：中文按 2 计，字母数字按 1 计', () => {
  assert.equal(billedChars('你好'), 4)
  assert.equal(billedChars('abc'), 3)
  assert.equal(billedChars('你好abc'), 7)
  assert.equal(billedChars('，。'), 4)      // 中文标点也按 2
  assert.equal(billedChars(''), 0)
})

test('长文本按计费字符切分，每段都不超限', () => {
  const text = '这是一句测试。'.repeat(150)   // 7 字 × 150 = 1050 字 → 约 2100 计费字符
  const parts = splitForTts(text, 1000)
  assert.ok(parts.length >= 2, '应该被切开')
  for (const part of parts) assert.ok(billedChars(part) <= 1000, '每段计费字符 <= 1000')
  // 拼回去内容不丢（空白差异允许）
  assert.equal(parts.join('').replace(/\s+/g, ''), text.replace(/\s+/g, ''))
})

test('单句超限时按字符硬切，且不超限', () => {
  const text = '啊'.repeat(2000)             // 4000 计费字符
  const parts = splitForTts(text, 900)
  assert.ok(parts.length >= 3)
  for (const part of parts) assert.ok(billedChars(part) <= 900)
})

test('PCM → WAV 头合法，可反解出时长', () => {
  const pcm = Buffer.alloc(24000 * 2 * 2)     // 24kHz 16bit 单声道 2 秒
  const wav = pcmToWav(pcm)
  assert.equal(wav.toString('ascii', 0, 4), 'RIFF')
  assert.equal(wav.toString('ascii', 8, 12), 'WAVE')
  const header = readWavHeader(wav)
  assert.ok(header)
  assert.equal(header.sampleRate, 24000)
  assert.equal(header.channels, 1)
  assert.equal(header.dataLength, pcm.length)
  assert.equal(pcmDurationMs(header.dataLength, header.sampleRate), 2000)
})

test('合成：mock HTTP 拿到 PCM，返回 wav 与时长', async () => {
  const pcm = Buffer.alloc(24000 * 2)         // 1 秒
  const calls = []
  const fakeFetch = async (url, init) => {
    calls.push({ url, body: JSON.parse(init.body) })
    return { ok: true, status: 200, arrayBuffer: async () => pcm.buffer.slice(pcm.byteOffset, pcm.byteOffset + pcm.length) }
  }
  const result = await synthesizeDeepseek('你好世界', { apiKey: 'k', voiceId: 'tide', fetchImpl: fakeFetch })
  assert.equal(result.extension, 'wav')
  assert.equal(result.durationMs, 1000)
  assert.equal(result.chunks, 1)
  assert.equal(calls[0].body.voice_id, 'tide')
  assert.equal(calls[0].body.format, 'pcm')
  assert.equal(calls[0].body.filter_markdown, true)
})

test('合成：HTTP 429 抛错并带提示（交给上层回落）', async () => {
  const fakeFetch = async () => ({ ok: false, status: 429, arrayBuffer: async () => new ArrayBuffer(0) })
  await assert.rejects(() => synthesizeDeepseek('hi', { apiKey: 'k', fetchImpl: fakeFetch }), /并发超限/)
})

test('WAV 切分：按秒数切成多段且每段头合法', () => {
  const pcm = Buffer.alloc(16000 * 2 * 5)      // 16k 单声道 5 秒
  const wav = pcmToWav(pcm, 16000)
  const parts = splitWav(wav, 2)               // 每段 2 秒 → 3 段
  assert.equal(parts.length, 3)
  for (const part of parts) {
    const header = readWavHeader(part)
    assert.ok(header)
    assert.equal(header.sampleRate, 16000)
    assert.ok(header.dataLength <= 16000 * 2 * 2)
  }
})

test('ASR：mock HTTP 返回文本，多段文本拼接', async () => {
  const pcm = Buffer.alloc(16000 * 2 * 30)     // 30 秒 → chunkSeconds=10 切成 3 段
  const wav = pcmToWav(pcm, 16000)
  const texts = ['第一段', '第二段', '第三段']
  let index = 0
  const fakeFetch = async () => {
    const text = texts[index++] ?? ''
    return { ok: true, status: 200, json: async () => ({ text, duration_ms: 1000, request_id: 'req-' + index }) }
  }
  // 直接调内部转写路径：避免 ffmpeg（传已是 wav 的临时文件）
  const { writeFile, mkdtemp, rm } = await import('node:fs/promises')
  const { tmpdir } = await import('node:os')
  const { join } = await import('node:path')
  const dir = await mkdtemp(join(tmpdir(), 'dsh-tts-asr-'))
  const file = join(dir, 'a.wav')
  await writeFile(file, wav)
  try {
    const result = await transcribeDeepseek(file, { apiKey: 'k', chunkSeconds: 10, fetchImpl: fakeFetch })
    assert.equal(result.text, '第一段第二段第三段')
    assert.equal(result.chunks, 3)
    assert.equal(result.provider, 'deepseek')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('切分上限常量与官方一致（1 万计费字符）', () => {
  assert.equal(MAX_BILLED_CHARS, 10000)
})
