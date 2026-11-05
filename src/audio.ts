/**
 * 音频文件仓（2026-11-05）：把引擎生成的音频落到磁盘，并通过 HTTP 提供给浏览器播放。
 *
 * 目录：`$DSH_HOME/dsh-tts/audio/`
 * 路由：`/dsh-tts/audio/<file>`（只允许文件名，防目录穿越）
 */
import { mkdirSync, readdirSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export interface AudioStoreOptions {
  dir: string
  /** 最多保留多少个文件（超出删最旧的） */
  keep?: number
  log?: (level: 'debug' | 'info' | 'warn', message: string) => void
}

export class AudioStore {
  private readonly options: AudioStoreOptions

  constructor(options: AudioStoreOptions) {
    this.options = options
  }

  dir(): string {
    return this.options.dir
  }

  /** 写一个音频文件，返回可访问的相对 URL 与文件名 */
  save(buffer: Buffer, extension: string): { file: string; url: string } {
    mkdirSync(this.options.dir, { recursive: true })
    const stamp = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14)
    const random = Math.random().toString(36).slice(2, 8)
    const file = 'tts-' + stamp + '-' + random + '.' + extension
    writeFileSync(join(this.options.dir, file), buffer)
    this.prune()
    return { file, url: '/dsh-tts/audio/' + file }
  }

  /** 按文件名取绝对路径（拒绝路径穿越） */
  resolve(file: string): string | undefined {
    if (!/^[A-Za-z0-9._-]+$/.test(file)) return undefined
    const full = join(this.options.dir, file)
    try {
      if (!statSync(full).isFile()) return undefined
    } catch {
      return undefined
    }
    return full
  }

  /** 超出上限时删最旧的（按修改时间） */
  prune(): void {
    const keep = this.options.keep ?? 200
    if (keep <= 0) return
    try {
      const files = readdirSync(this.options.dir)
        .filter(name => name.startsWith('tts-'))
        .map(name => ({ name, at: statSync(join(this.options.dir, name)).mtimeMs }))
        .sort((a, b) => a.at - b.at)
      const extra = files.length - keep
      for (let index = 0; index < extra; index += 1) {
        const target = files[index]
        if (target === undefined) continue
        try { unlinkSync(join(this.options.dir, target.name)) } catch { /* 忽略 */ }
      }
    } catch (error) {
      this.options.log?.('warn', '清理音频缓存失败: ' + (error instanceof Error ? error.message : String(error)))
    }
  }

  stats(): { count: number; bytes: number } {
    try {
      const files = readdirSync(this.options.dir).filter(name => name.startsWith('tts-'))
      let bytes = 0
      for (const name of files) {
        try { bytes += statSync(join(this.options.dir, name)).size } catch { /* 忽略 */ }
      }
      return { count: files.length, bytes }
    } catch {
      return { count: 0, bytes: 0 }
    }
  }
}
