import assert from 'node:assert/strict'
import test from 'node:test'

test('待播队列：序号单调、since 只取新的、满了丢最旧', async () => {
  const { UtteranceQueue } = await import('../lib/queue.js')
  const queue = new UtteranceQueue(3)
  const a = queue.push({ text: '第一句', source: 'agent' })
  const b = queue.push({ text: '第二句', source: 'agent' })
  assert.equal(a.seq, 1)
  assert.equal(b.seq, 2)

  // since=0 全量
  assert.deepEqual(queue.pending(0).items.map(item => item.text), ['第一句', '第二句'])
  // since=1 只取新的
  const after = queue.pending(1)
  assert.deepEqual(after.items.map(item => item.text), ['第二句'])
  assert.equal(after.cursor, 2)

  // 队列满：丢最旧
  queue.push({ text: '第三句', source: 'agent' })
  queue.push({ text: '第四句', source: 'agent' })
  const stats = queue.stats()
  assert.equal(stats.length, 3, '上限 3')
  assert.equal(stats.dropped, 1, '丢了 1 条')
  assert.deepEqual(queue.pending(0).items.map(item => item.text), ['第二句', '第三句', '第四句'])

  queue.clear()
  assert.equal(queue.stats().length, 0)
})

test('provider 注册表：重复注册报错、list 带 side、get 按 id', async () => {
  const { ProviderRegistry } = await import('../lib/providers.js')
  const logs = []
  const registry = new ProviderRegistry({ log: (level, message) => logs.push(level + ':' + message) })
  const dispose = registry.register({
    info: { id: 'browser', label: '浏览器', side: 'client' },
    speak: async () => ({ provider: 'browser', side: 'client', utterance: { seq: 1, text: '', source: 'x', createdAt: 0 }, note: '' }),
  })
  assert.equal(registry.list().length, 1)
  assert.equal(registry.list()[0].side, 'client')
  assert.ok(registry.get('browser') !== undefined)
  assert.throws(() => registry.register({
    info: { id: 'browser', label: '重复', side: 'client' },
    speak: async () => ({ provider: 'browser', side: 'client', utterance: { seq: 1, text: '', source: 'x', createdAt: 0 }, note: '' }),
  }), /已注册/)
  dispose()
  assert.equal(registry.list().length, 0)
  assert.ok(logs.some(line => line.includes('已注册 TTS 引擎')))
})

test('配置：默认浏览器引擎、各字段有默认值、用户值覆盖', async () => {
  const { resolveConfig, DEFAULTS } = await import('../lib/config.js')
  assert.equal(DEFAULTS.provider, 'browser', '默认用浏览器朗读（零依赖）')
  assert.equal(DEFAULTS.enabled, true)
  assert.equal(DEFAULTS.language, 'zh-CN')
  assert.equal(DEFAULTS.maxChars, 300)
  const merged = resolveConfig({ provider: 'comfyui', rate: 1.2 })
  assert.equal(merged.provider, 'comfyui')
  assert.equal(merged.rate, 1.2)
  assert.equal(merged.volume, 1, '没传的沿用默认')
})
