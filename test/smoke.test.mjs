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

test('配置：默认 Edge 引擎、各字段有默认值、用户值覆盖', async () => {
  const { resolveConfig, DEFAULTS } = await import('../lib/config.js')
  assert.equal(DEFAULTS.provider, 'edge', '默认用 Edge TTS（免费免 key）')
  assert.equal(DEFAULTS.enabled, true)
  assert.equal(DEFAULTS.edgeVoice, 'zh-CN-XiaoxiaoNeural')
  assert.equal(DEFAULTS.maxChars, 300)
  const merged = resolveConfig({ provider: 'volc', maxChars: 120 })
  assert.equal(merged.provider, 'volc')
  assert.equal(merged.maxChars, 120)
  assert.equal(merged.edgeVoice, 'zh-CN-XiaoxiaoNeural', '没传的沿用默认')
})
test('Edge：Sec-MS-GEC 签名稳定（同 5 分钟窗口内一致）与 SSML 结构', async () => {
  const { secMsGec, buildSsml } = await import('../lib/edge.js')
  const a = secMsGec(1_700_000_000_000)
  const b = secMsGec(1_700_000_000_000 + 10_000)
  assert.equal(a, b, '同一 300 秒窗口签名相同')
  const later = secMsGec(1_700_000_000_000 + 400_000)
  assert.notEqual(a, later, '跨窗口签名变化')
  assert.match(a, /^[0-9A-F]{64}$/)
  const ssml = buildSsml('你好 & 再见', { voice: 'zh-CN-XiaoxiaoNeural', ratePercent: 20, pitchHz: -5 })
  assert.ok(ssml.includes('zh-CN-XiaoxiaoNeural'))
  assert.ok(ssml.includes('rate="+20%"'))
  assert.ok(ssml.includes('pitch="-5Hz"'))
  assert.ok(ssml.includes('&amp;'), 'XML 特殊字符要转义')
})

test('火山方舟：没 API Key 时立刻报错而不是发请求', async () => {
  const { synthesizeVolc } = await import('../lib/volc.js')
  await assert.rejects(() => synthesizeVolc('测试', { apiKey: '' }), /API Key/)
  await assert.rejects(() => synthesizeVolc('   ', { apiKey: 'x' }), /空的/)
})

test('音频仓：落盘、按名字解析、拒绝路径穿越、超量清理', async () => {
  const { mkdtemp, rm } = await import('node:fs/promises')
  const { tmpdir } = await import('node:os')
  const { join } = await import('node:path')
  const { AudioStore } = await import('../lib/audio.js')
  const dir = await mkdtemp(join(tmpdir(), 'tts-audio-'))
  const store = new AudioStore({ dir, keep: 2 })
  const a = store.save(Buffer.from('aaa'), 'mp3')
  assert.ok(a.url.startsWith('/dsh-tts/audio/'))
  assert.notEqual(store.resolve(a.file), undefined)
  assert.equal(store.resolve('../etc/passwd'), undefined, '拒绝路径穿越')
  assert.equal(store.resolve('nope.mp3'), undefined)
  store.save(Buffer.from('bbb'), 'mp3')
  store.save(Buffer.from('ccc'), 'mp3')
  const stats = store.stats()
  assert.equal(stats.count, 2, 'keep=2 时只留两个')
  await rm(dir, { recursive: true, force: true })
})
test('配置热更新：profile YAML 改了，运行中的插件立刻读到新值', async () => {
  const { mkdtemp, mkdir, writeFile, rm } = await import('node:fs/promises')
  const { tmpdir } = await import('node:os')
  const { join } = await import('node:path')
  const root = await mkdtemp(join(tmpdir(), 'dshhome-'))
  await mkdir(join(root, 'profiles', 'web'), { recursive: true })
  const file = join(root, 'profiles', 'web', 'cordis.patch.yml')
  const write = (provider, voice, maxChars) => writeFile(file, [
    '- id: dsh-tts',
    '  name: dsh-tts',
    '  config:',
    '    provider: ' + provider,
    '    edgeVoice: ' + voice,
    '    maxChars: ' + String(maxChars),
  ].join('\n'), 'utf8')
  await write('edge', 'zh-CN-XiaoxiaoNeural', 300)
  const previous = process.env.DSH_HOME
  process.env.DSH_HOME = root
  try {
    const { LiveConfig, parseTtsBlock } = await import('../lib/liveconfig.js')
    const { resolveConfig } = await import('../lib/config.js')
    const live = new LiveConfig({ initial: resolveConfig({}) })
    assert.equal(live.get().edgeVoice, 'zh-CN-XiaoxiaoNeural', '首次应读到磁盘值')
    await new Promise(resolve => setTimeout(resolve, 1100))
    await write('volc', 'zh-CN-liaoning-XiaobeiNeural', 120)
    const after = live.get()
    assert.equal(after.provider, 'volc')
    assert.equal(after.edgeVoice, 'zh-CN-liaoning-XiaobeiNeural')
    assert.equal(after.maxChars, 120)

    // 解析函数：只取 dsh-tts 块
    const parsed = parseTtsBlock('- id: dsh-tts\n  config:\n    provider: volc\n    volcApiKey: "ark-1"\n- id: other\n')
    assert.equal(parsed.provider, 'volc')
    assert.equal(parsed.volcApiKey, 'ark-1')
  } finally {
    if (previous === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = previous
    await rm(root, { recursive: true, force: true })
  }
})