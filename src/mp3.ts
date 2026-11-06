/**
 * MP3 时长解析（零依赖）。
 *
 * 为什么需要：桌宠口型、进度条、事件订阅者都要知道"这段语音多长"。
 * 合成端（Edge / 火山）都输出 mp3，所以只解析 mp3 就够，不引第三方库。
 *
 * 做法：逐帧扫 MPEG 音频帧头，累加每帧采样数，除以采样率。
 * 只读文件头与帧头，不加载整段音频。
 */
import { open } from 'node:fs/promises'

const BITRATES: Record<string, number[]> = {
  // [version][layer] → kbps 表（index 1..14，0/15 非法）
  '1-1': [0, 32, 64, 96, 128, 160, 192, 224, 256, 288, 320, 352, 384, 416, 448],
  '1-2': [0, 32, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 384],
  '1-3': [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320],
  '2-1': [0, 32, 48, 56, 64, 80, 96, 112, 128, 144, 160, 176, 192, 224, 256],
  '2-2': [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160],
  '2-3': [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160],
}

const SAMPLE_RATES: Record<number, number[]> = {
  3: [44100, 48000, 32000, 0], // MPEG1
  2: [22050, 24000, 16000, 0], // MPEG2
  0: [11025, 12000, 8000, 0], // MPEG2.5
}

export interface Mp3Info {
  /** 时长（毫秒，取整） */
  durationMs: number
  /** 采样率（Hz） */
  sampleRate: number
  /** 解析到的帧数 */
  frames: number
  /** 是否解析成功（有些文件头不是标准 mp3，比如 exFAT 上的 ID3v2 很长） */
  ok: boolean
}

/**
 * 读 mp3 头部（跳过 ID3v2）并逐帧累加时长。
 * 只读前 256KB + 每帧头 4 字节，避免大文件整读。
 */
export async function mp3Duration(path: string): Promise<Mp3Info> {
  const handle = await open(path, 'r')
  try {
    const head = Buffer.alloc(10)
    await handle.read(head, 0, 10, 0)
    let offset = 0
    // ID3v2 头：'ID3' + 版本(2) + flags(1) + size(4, syncsafe)
    if (head[0] === 0x49 && head[1] === 0x44 && head[2] === 0x33) {
      const size = ((head[6] ?? 0) & 0x7f) * 0x200000 + ((head[7] ?? 0) & 0x7f) * 0x4000 + ((head[8] ?? 0) & 0x7f) * 0x80 + ((head[9] ?? 0) & 0x7f)
      offset = 10 + size
    }
    const buffer = Buffer.alloc(64 * 1024)
    let samples = 0
    let frames = 0
    let sampleRate = 0
    let position = offset
    let carry = Buffer.alloc(0)
    for (let reads = 0; reads < 512; reads += 1) {
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, position)
      if (bytesRead <= 0) break
      let data = carry.length > 0 ? Buffer.concat([carry, buffer.subarray(0, bytesRead)]) : buffer.subarray(0, bytesRead)
      position += bytesRead
      let index = 0
      while (index + 4 <= data.length) {
        // 帧同步：0xFF Ex
        if (data[index] !== 0xff || ((data[index + 1] ?? 0) & 0xe0) !== 0xe0) {
          index += 1
          continue
        }
        const header = data.readUInt32BE(index)
        const versionBits = (header >>> 19) & 0b11
        const layerBits = (header >>> 17) & 0b11
        const bitrateIndex = (header >>> 12) & 0b1111
        const rateIndex = (header >>> 10) & 0b11
        const padding = (header >>> 9) & 0b1
        if (versionBits === 1 || layerBits === 0 || bitrateIndex === 0 || bitrateIndex === 15 || rateIndex === 3) {
          index += 1
          continue
        }
        const versionKey = versionBits === 3 ? '1' : '2'
        const layer = 4 - layerBits
        const table = BITRATES[versionKey + '-' + layer]
        const rateTable = SAMPLE_RATES[versionBits]
        const bitrateKbps = table?.[bitrateIndex] ?? 0
        const rate = rateTable?.[rateIndex] ?? 0
        if (bitrateKbps === 0 || rate === 0) {
          index += 1
          continue
        }
        // 每帧字节数
        const frameBytes = layer === 1
          ? Math.floor((12 * bitrateKbps * 1000) / rate + padding) * 4
          : Math.floor((layer === 2 ? 144 : 144) * bitrateKbps * 1000 / rate) + padding
        if (frameBytes <= 4) {
          index += 1
          continue
        }
        const samplesPerFrame = layer === 1 ? 384 : layer === 2 ? 1152 : (versionBits === 3 ? 1152 : 576)
        samples += samplesPerFrame
        sampleRate = rate
        frames += 1
        index += frameBytes
        if (index > data.length) {
          carry = data.subarray(Math.max(0, index - frameBytes))
          break
        }
      }
      if (index >= data.length) carry = Buffer.alloc(0)
      if (carry.length > 0) {
        // 保留最后不足一帧的部分，拼到下一块开头
        carry = data.subarray(Math.max(0, data.length - carry.length))
      }
      if (frames > 0 && data.length < buffer.length) break
    }
    if (frames === 0 || sampleRate === 0) return { durationMs: 0, sampleRate: 0, frames: 0, ok: false }
    return { durationMs: Math.round((samples / sampleRate) * 1000), sampleRate, frames, ok: true }
  } finally {
    await handle.close()
  }
}
