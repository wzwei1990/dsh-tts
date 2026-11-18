/**
 * dsh-tts 浏览器半边（手写客户端模块，免构建）。
 *
 * 职责：
 *   1. 设置页「语音（TTS）」：引擎二选一（Edge / 火山方舟）、音色下拉、试听
 *   2. 播放器：轮询 /dsh-tts/api/pending，用 <audio> 播放服务端合成的音频
 *
 * ⚠️ 整段包在 IIFE 里：客户端模块共享全局作用域，顶层声明会和别的插件撞名。
 */
;(() => {
  const moduleLoader = typeof window === 'undefined' ? undefined : window.__ModuleLoader__
  if (moduleLoader === undefined || moduleLoader === null) return

  moduleLoader.load({
    id: 'dsh-tts',
    factory: (require) => {
      var module = { exports: {} }
      var exports = module.exports

      const react = require('react')
      const NS = 'dsh-tts'
      const POLL_MS = 1200
      const CUSTOM = '__custom__'

      /** 静态兜底（真正列表从 /dsh-tts/api/voices 拉） */
      const FALLBACK = {
        edge: [
          ['zh-CN-XiaoxiaoNeural', '晓晓 · 女声（最常用）'],
          ['zh-CN-XiaoyiNeural', '晓伊 · 女声'],
          ['zh-CN-liaoning-XiaobeiNeural', '晓北 · 女声（东北话）'],
          ['zh-TW-HsiaoChenNeural', '曉臻 · 女声（台湾）'],
          ['zh-HK-HiuMaanNeural', '曉曼 · 女声（粤语）'],
          ['ja-JP-NanamiNeural', 'ナナミ · 女声（日语）'],
          ['en-US-AriaNeural', 'Aria · 女声（英语）'],
        ],
        volc: [
          ['zh_female_vv_uranus_bigtts', 'Vivi 2.0 · 女声（主打）'],
          ['zh_female_xiaohe_uranus_bigtts', '小何 2.0 · 女声（主打）'],
          ['zh_male_m191_uranus_bigtts', '云舟 2.0 · 男声（主打）'],
          ['zh_male_taocheng_uranus_bigtts', '小天 2.0 · 男声（主打）'],
          ['zh_female_gaolengyujie_uranus_bigtts', '高冷御姐 2.0 · 女声'],
          ['zh_female_tianmeitaozi_uranus_bigtts', '甜美桃子 2.0 · 女声'],
        ],
        deepseek: [
          ['stella', '海星 · 女声（默认）'],
          ['tide', '暗潮 · 男声'],
        ],
      }

      function buildFields(voices) {
        const withCustom = (list) => (list && list.length > 0 ? list : []).concat([[CUSTOM, '自定义…（填下面的文本框）']])
        return [
          { section: '引擎' },
          {
            key: 'provider',
            label: '语音引擎',
            kind: 'select',
            options: [['edge', 'Edge TTS（免费免 key，默认）'], ['volc', '火山方舟（豆包音色，要 API Key）'], ['deepseek', 'DeepSeek 官方（stella / tide，要 API Key）']],
            hint: '切换只改这个下拉框，不用重启；下次朗读就走新引擎。',
          },
          { key: 'enabled', label: '允许模型主动朗读（tts_speak）', kind: 'boolean' },
          { key: 'maxChars', label: '单条最长字符数（超出截断）', kind: 'number', hint: '默认 300' },
          { key: 'queueSize', label: '待播队列长度上限', kind: 'number', hint: '默认 10，满了丢最旧的' },
          { key: 'audioKeep', label: '最多保留多少条音频文件（0=不限）', kind: 'number', hint: '默认 200，超出删最旧' },

          { section: '自动朗读' },
            {
              key: 'autoRead',
              label: '把模型回复合成成语音，播放一遍',
              kind: 'boolean',
              hint: '开=每轮最终回复都合成并播放（和 QQ 语音同一套文本清洗、同一个音色，所以念的内容一致）；关=只有模型主动调 tts_speak 或点试听时才出声。\nQQ 通道的会话固定跳过（那边由 napcat 自己发语音），不会重复念。',
            },
            { section: 'Edge TTS' },
          {
            key: 'edgeVoice', dependsOn: { key: 'provider', equals: 'edge' },
            label: '音色（下拉选）',
            kind: 'select',
            options: withCustom(voices.edge),
            hint: '内置清单取自 Edge 官方 voices/list（实测拉取）；要别的选「自定义」。',
          },
          { key: 'edgeVoiceCustom', dependsOn: { key: 'provider', equals: 'edge' }, label: 'Edge 自定义音色（选「自定义」时生效）', kind: 'text', placeholder: 'zh-CN-XiaoxiaoNeural' },
          { key: 'edgeRatePercent', dependsOn: { key: 'provider', equals: 'edge' }, label: '语速百分比（+20 = 快 20%）', kind: 'number', hint: '默认 0，范围 -50~100' },
          { key: 'edgePitchHz', dependsOn: { key: 'provider', equals: 'edge' }, label: '音高 Hz（正数更高）', kind: 'number', hint: '默认 0，范围 -50~50' },
          { key: 'edgeVolumePercent', dependsOn: { key: 'provider', equals: 'edge' }, label: '音量百分比（0=原始）', kind: 'number', hint: '默认 0，范围 -50~100' },

          { section: '火山方舟（豆包语音合成 2.0）' },
          {
            key: 'volcApiKey', dependsOn: { key: 'provider', equals: 'volc' },
            label: '专属 API Key',
            kind: 'password',
            hint: '火山方舟控制台 → Agent Plan → API Key。填了它再把引擎切到火山即可。',
          },
          {
            key: 'volcSpeaker', dependsOn: { key: 'provider', equals: 'volc' },
            label: '音色（下拉选）',
            kind: 'select',
            options: withCustom(voices.volc),
            hint: '清单取自官方「豆包语音合成模型 2.0 音色列表」；能否使用取决于你账号的音色授权/资源包。',
          },
          { key: 'volcSpeakerCustom', dependsOn: { key: 'provider', equals: 'volc' }, label: '火山自定义音色（选「自定义」时生效）', kind: 'text', placeholder: 'zh_female_vv_uranus_bigtts' },

          { section: 'DeepSeek 官方语音（TTS）' },
          {
            key: 'deepseekApiKey', dependsOn: { key: 'provider', equals: 'deepseek' },
            label: 'API Key',
            kind: 'password',
            hint: '留空则读环境变量 DEEPSEEK_API_KEY；同一个 key 也用于 DeepSeek 语音识别。',
          },
          {
            key: 'deepseekVoice', dependsOn: { key: 'provider', equals: 'deepseek' },
            label: '音色',
            kind: 'select',
            options: (voices.deepseek && voices.deepseek.length > 0 ? voices.deepseek : []).concat([['stella', '海星 · 女声（默认）'], ['tide', '暗潮 · 男声']]).filter((item, index, all) => all.findIndex(other => other[0] === item[0]) === index),
            hint: '官方目前只有 2 个音色：stella（女）/ tide（男）；不支持语速、情感与音色克隆。',
          },

          { section: '语音识别（ASR）' },
          { key: 'asrEnabled', label: '启用语音识别（把收到的语音转成文字）', kind: 'boolean' },
          {
            key: 'asrProvider',
            label: '识别引擎',
            kind: 'select',
            options: [['volc', '火山 ASR（流式，可带时间戳，默认）'], ['deepseek', 'DeepSeek 官方 ASR（整段、≤120 秒、无时间戳）']],
            hint: '两者独立于上面的 TTS 引擎：可以「火山 TTS + DeepSeek ASR」混搭。',
          },
          { section: '日志' },
          {
            key: 'logLevel',
            label: '日志级别',
            kind: 'select',
            options: [['info', 'info：只记关键事件'], ['debug', 'debug：每次朗读都打'], ['warn', 'warn：只记问题']],
          },
        ]
      }

      const style = {
        wrap: { display: 'flex', flexDirection: 'column', gap: '12px', padding: '4px 2px', maxWidth: '720px' },
        hint: { fontSize: '12px', color: 'var(--dsw-alias-label-secondary, #666)', margin: 0 },
        row: { display: 'flex', flexDirection: 'column', gap: '4px' },
        label: { fontSize: '13px', fontWeight: 600 },
        sub: { fontSize: '12px', color: 'var(--dsw-alias-label-secondary, #666)', margin: 0 },
        input: {
          font: 'inherit', fontSize: '13px', padding: '7px 9px', borderRadius: '6px',
          border: '1px solid var(--dsw-alias-border-l2, #d0d0d0)',
          background: 'var(--dsw-alias-bg-l1, #fff)', color: 'inherit', width: '100%', boxSizing: 'border-box',
        },
        checkRow: { display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px' },
        bar: { display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap', marginTop: '6px' },
        btn: {
          font: 'inherit', fontSize: '13px', padding: '7px 14px', borderRadius: '6px', cursor: 'pointer',
          border: '1px solid var(--dsw-alias-border-l2, #d0d0d0)', background: 'transparent', color: 'inherit',
        },
        primary: {
          font: 'inherit', fontSize: '13px', padding: '7px 14px', borderRadius: '6px', cursor: 'pointer',
          border: '1px solid transparent', background: 'var(--dsw-alias-state-business-primary, #1677ff)', color: '#fff',
        },
        error: { color: 'var(--dsw-alias-state-error-primary, #d4380d)', fontSize: '12px', margin: 0, whiteSpace: 'pre-wrap' },
        ok: { color: 'var(--dsw-alias-state-success-primary, #389e0d)', fontSize: '12px', margin: 0 },
      }

      function unwrap(result) {
        if (result !== null && typeof result === 'object' && Object.prototype.hasOwnProperty.call(result, 'ok')) {
          if (result.ok !== true) {
            const code = result.error && result.error.code
            const message = result.error && result.error.message
            throw new Error((code ? code + ': ' : '') + (message || 'remote call failed'))
          }
          return result.value
        }
        return result
      }

      function remoteOf(ctx) {
        try {
          const viaNamespace = ctx.remote && ctx.remote.settings
          if (viaNamespace && typeof viaNamespace.describe === 'function') return { settings: viaNamespace }
          const viaService = typeof ctx.get === 'function' ? ctx.get('remote.settings') : undefined
          if (viaService && typeof viaService.describe === 'function') return { settings: viaService }
          return null
        } catch (error) {
          return null
        }
      }

      /** 播放器：只播服务端合成好的音频（edge / volc 都有 audioUrl） */
      /** 全局播放器单例：队列轮询必须跟页面同寿，不能只在设置面板打开时跑 */
      let sharedPlayer = null
      function ensurePlayer() {
        if (sharedPlayer === null) sharedPlayer = createPlayer()
        return sharedPlayer
      }

      function createPlayer() {
        let cursor = 0
        let timer
        let busy = false
        try {
          const stored = window.localStorage.getItem('dsh-tts:cursor')
          if (stored !== null) cursor = Number(stored) || 0
        } catch (error) { /* 隐私模式没有 localStorage */ }

        const saveCursor = (value) => {
          cursor = value
          try { window.localStorage.setItem('dsh-tts:cursor', String(value)) } catch (error) { /* 忽略 */ }
        }

        /**
         * 告诉页面「现在在说话 / 说完了」。
         *
         * 用中立的 `dsh:speaking` 事件，而不是直接调用某个桌宠插件：
         * - dsh-tts 不认识桌宠，桌宠也可能没装 → 没有监听者时 dispatch 是纯 no-op
         * - 桌宠（或其他想联动的插件）自己 addEventListener 即可，互不依赖
         * - 派发失败（老浏览器 / 被 CSP 拦）也只是静默跳过，绝不影响朗读本身
         */
        const signalSpeaking = (on, extra) => {
          try {
            document.dispatchEvent(new CustomEvent('dsh:speaking', { detail: { on, ...(extra || {}) } }))
          } catch {
            /* 联动失败不影响播放 */
          }
        }

        /**
         * 播一条。返回 { ok, error } —— 不再把失败当成功，
         * 否则会出现"显示已播放但没声音"。
         */
        const playOne = (item) => new Promise((resolve) => {
          if (typeof item.audioUrl !== 'string' || item.audioUrl === '') {
            resolve({ ok: false, error: '没有 audioUrl' })
            return
          }
          let audio
          try {
            audio = new window.Audio(item.audioUrl)
          } catch (error) {
            resolve({ ok: false, error: '创建 Audio 失败：' + String(error && error.message ? error.message : error) })
            return
          }
          let settled = false
          const finish = (result) => {
            if (settled) return
            settled = true
            signalSpeaking(false, { url: item.audioUrl, ok: result.ok === true })
            resolve(result)
          }
          audio.onended = () => finish({ ok: true })
          audio.onerror = () => {
            const code = audio.error && audio.error.code
            const map = { 1: '加载被中断', 2: '网络错误（音频文件取不到）', 3: '解码失败', 4: '格式不支持或文件损坏' }
            finish({ ok: false, error: (map[code] || '音频加载失败') + '（code ' + String(code ?? '?') + '）' })
          }
          window.dispatchEvent(new CustomEvent('dsh-tts:speak', { detail: item }))
          try {
            const played = audio.play()
            if (played && typeof played.then === 'function') {
              played.then(() => { signalSpeaking(true, { url: item.audioUrl }) }).catch((error) => {
                const name = error && error.name
                const hint = name === 'NotAllowedError'
                  ? '浏览器要求先点一下页面才能播放（自动播放被拦）'
                  : name === 'NotSupportedError'
                    ? '浏览器不支持这个音频格式'
                    : String(error && error.message ? error.message : error)
                finish({ ok: false, error: hint })
              })
            }
            // 兜底：长时间没有 ended 也当作播放过（避免队列卡住）
            setTimeout(() => finish({ ok: true }), 60_000)
          } catch (error) {
            finish({ ok: false, error: String(error && error.message ? error.message : error) })
          }
        })

        /** 把客户端状态报给服务端（写进 autoread-probe.log），便于定位"服务端念了但浏览器没声" */
        const report = (stage, detail) => {
          try {
            void fetch('/dsh-tts/api/client-report', {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ stage, detail, at: Date.now() }),
            })
          } catch { /* 诊断失败不影响播放 */ }
        }

        /**
         * 单实例播放锁（Web Locks）。
         * 多开标签页/窗口时，每个页面都会轮询同一个服务端队列，
         * 于是同一句会被两个播放器同时拉走 → "重叠播放"（2026-11-17 用户反馈）。
         * 只有拿到锁的那个页面负责播放；它关掉后，锁自动释放给下一个排队者。
         */
        let isLeader = false
        const LEADER_LOCK = 'dsh-tts:player-leader'
        const claimLeadership = async () => {
          const locks = typeof navigator !== 'undefined' ? navigator.locks : undefined
          if (locks === undefined || typeof locks.request !== 'function') {
            isLeader = true
            return
          }
          try {
            await locks.request(LEADER_LOCK, async () => {
              isLeader = true
              report('leader', { tab: true })
              // 立刻把本地 cursor 对齐到服务端，避免接手时把别的页已经播过的重播一遍
              try {
                const res = await fetch('/dsh-tts/api/pending?since=' + String(cursor), { cache: 'no-store' })
                if (res.ok) {
                  const payload = await res.json()
                  if (typeof payload.cursor === 'number' && payload.cursor > cursor) {
                    cursor = payload.cursor
                    saveCursor(cursor)
                  }
                }
              } catch { /* 对齐失败就按原 cursor 继续 */ }
              // 持锁直到页面关闭（不 resolve）
              await new Promise(() => {})
            })
          } catch {
            isLeader = true
          }
        }

        /** 被浏览器自动播放策略拦过：下次用户手势后重试 */
        let blockedByAutoplay = false
        const tick = async () => {
          if (!isLeader) return
          if (busy) return
          busy = true
          try {
            const response = await fetch('/dsh-tts/api/pending?since=' + String(cursor), { cache: 'no-store' })
            if (!response.ok) return
            const payload = await response.json()
            const items = Array.isArray(payload.items) ? payload.items : []
            // 服务端重启后队列序号从 1 重新开始，而本地 cursor 还停在旧的大值
            // → `seq > cursor` 永远为空，自动朗读的条目永远拉不到（2026-11-17 实测踩到）。
            // 服务端返回的 cursor 比本地小 = 服务端已重启，重置本地 cursor。
            const serverCursor = typeof payload.cursor === 'number' ? payload.cursor : null
            if (serverCursor !== null && serverCursor < cursor) {
              console.warn('[dsh-tts] 队列序号回退（服务端重启过），cursor ' + cursor + ' → ' + serverCursor)
              cursor = 0
              saveCursor(0)
              report('cursor-reset', { from: serverCursor })
            }
            // 只在真的拉到条目时上报：每 1.2s 的空轮询会把服务端探针挤掉（2026-11-18 实测 200 行里 187 行是它）
            if (items.length > 0) report('pending', { count: items.length, cursor })
            if (items.length === 0) {
              if (typeof payload.cursor === 'number' && payload.cursor > cursor) saveCursor(payload.cursor)
              return
            }
            for (const item of items) {
              // 过期条目不再补播：页面隐藏/后台被节流时队列会积压，
              // 恢复后一次性补念会表现为"会话早结束了，突然又读两次"（2026-11-18 用户反馈）。
              const age = typeof item.createdAt === 'number' ? Date.now() - item.createdAt : 0
              if (age > 120_000) {
                report('stale-skip', { seq: item.seq, ageMs: age })
                saveCursor(item.seq)
                continue
              }
              const result = await playOne(item)
              report('play', { ok: result.ok, error: result.error ?? null, seq: item.seq })
              if (!result.ok) {
                console.warn('[dsh-tts] 播放失败: ' + result.error)
                // 自动播放被拦：不推进 cursor，等用户第一次点页面再重试，
                // 否则这条就被"当成播过了"永久丢掉（2026-11-17 实测踩到）。
                if (String(result.error).includes('自动播放')) {
                  blockedByAutoplay = true
                  break
                }
              }
              saveCursor(item.seq)
            }
          } catch (error) {
            // 服务端没挂上路由时静默重试
          } finally {
            busy = false
          }
        }

        const start = () => {
          if (timer !== undefined) return
          report('start', { player: 'global-v3', cursor })
          void claimLeadership()
          timer = setInterval(() => { void tick() }, POLL_MS)
          void tick()
        }
        const stop = () => {
          if (timer !== undefined) { clearInterval(timer); timer = undefined }
        }
        return {
          start,
          stop,
          playOne,
          /** 用户手势后重试一次（自动播放解锁） */
          kick: () => {
            blockedByAutoplay = false
            void tick()
          },
          getCursor: () => cursor,
          setCursor: saveCursor,
        }
      }

      function renderField(field, value, onChange) {
        const id = NS + '-' + field.key
        if (field.kind === 'boolean') {
          return react.createElement('div', { style: style.checkRow, key: field.key },
            react.createElement('input', {
              id, type: 'checkbox', checked: Boolean(value),
              onChange: (event) => onChange(field.key, event.target.checked),
            }),
            react.createElement('label', { htmlFor: id }, field.label))
        }
        let control
        if (field.kind === 'select') {
          control = react.createElement('select', {
            id, style: style.input, value: value == null ? '' : String(value),
            onChange: (event) => onChange(field.key, event.target.value),
          }, field.options.map((pair) => react.createElement('option', { key: pair[0], value: pair[0] }, pair[1])))
        } else if (field.kind === 'number') {
          control = react.createElement('input', {
            id, type: 'number', style: style.input, value: value == null ? '' : String(value),
            onChange: (event) => onChange(field.key, event.target.value === '' ? undefined : Number(event.target.value)),
          })
        } else {
          control = react.createElement('input', {
            id, type: field.kind === 'password' ? 'password' : 'text', style: style.input,
            placeholder: field.placeholder, value: value == null ? '' : String(value),
            onChange: (event) => onChange(field.key, event.target.value),
          })
        }
        return react.createElement('div', { style: style.row, key: field.key },
          react.createElement('label', { style: style.label, htmlFor: id }, field.label),
          field.hint === undefined ? null : react.createElement('p', { style: style.sub }, field.hint),
          control)
      }

      function TtsSettingsPage(props) {
        const ctx = props.ctx
        const [state, setState] = react.useState({ phase: 'loading' })
        const [draft, setDraft] = react.useState({})
        const [revision, setRevision] = react.useState(undefined)
        const [message, setMessage] = react.useState(undefined)
        const [voices, setVoices] = react.useState({ edge: FALLBACK.edge, volc: FALLBACK.volc, deepseek: FALLBACK.deepseek })
        const [testText, setTestText] = react.useState('你好呀，我是小灯，这是语音试听。')
        const [auditioning, setAuditioning] = react.useState(false)
        const player = react.useMemo(() => ensurePlayer(), [])

        // 拉音色列表（失败就用内置兜底）
        react.useEffect(() => {
          let cancelled = false
          void (async () => {
            try {
              const [edgeRes, volcRes] = await Promise.all([
                fetch('/dsh-tts/api/voices?provider=edge', { cache: 'no-store' }),
                fetch('/dsh-tts/api/voices?provider=volc', { cache: 'no-store' }),
              ])
              const edgeJson = edgeRes.ok ? await edgeRes.json() : undefined
              const volcJson = volcRes.ok ? await volcRes.json() : undefined
              if (cancelled) return
              const toPairs = (payload, fallback) => {
                const list = payload && Array.isArray(payload.voices) ? payload.voices : []
                if (list.length === 0) return fallback
                return list.map((item) => [item.id, item.label])
              }
              setVoices({ edge: toPairs(edgeJson, FALLBACK.edge), volc: toPairs(volcJson, FALLBACK.volc) })
            } catch (error) { /* 保留兜底 */ }
          })()
          return () => { cancelled = true }
        }, [])

        const fieldList = react.useMemo(() => buildFields(voices), [voices])

        const load = react.useCallback(async () => {
          const remote = remoteOf(ctx)
          if (remote === null) { setState({ phase: 'unsupported' }); return }
          setState({ phase: 'loading' })
          try {
            const described = unwrap(await remote.settings.describe())
            const list = described && Array.isArray(described.namespaces) ? described.namespaces : []
            if (!Array.isArray(described && described.namespaces)) {
              throw new Error('describe 返回的形状不对：' + JSON.stringify(described).slice(0, 200))
            }
            const row = list.find((item) => item && item.ns === NS)
            if (row === undefined) { setState({ phase: 'missing' }); return }
            setDraft(Object.assign({}, row.value || {}))
            setRevision(row.revision)
            setState({ phase: 'ready' })
          } catch (error) {
            setState({ phase: 'error', error: String(error && error.message ? error.message : error) })
          }
        }, [ctx])

        react.useEffect(() => { void load() }, [load])
        react.useEffect(() => {
          player.start()
          return () => player.stop()
        }, [player])

        const save = async () => {
          const remote = remoteOf(ctx)
          if (remote === null) return
          setMessage(undefined)
          try {
            const described = unwrap(await remote.settings.describe())
            const list = described && Array.isArray(described.namespaces) ? described.namespaces : []
            const row = list.find((item) => item && item.ns === NS)
            const next = {}
            for (const field of fieldList) {
              if (!Object.prototype.hasOwnProperty.call(draft, field.key)) continue
              const value = draft[field.key]
              if (value === undefined) continue
              if (field.kind === 'number') { next[field.key] = Number(value); continue }
              if (field.kind === 'boolean') { next[field.key] = Boolean(value); continue }
              next[field.key] = value
            }
            await unwrap(await remote.settings.update(NS, next, row ? row.revision : revision))
            setMessage({ ok: true, text: '已保存（写入 profile 的 cordis.patch.yml；插件会自动重读配置，几秒内生效，无需重启）' })
            await load()
          } catch (error) {
            setMessage({ ok: false, text: '保存失败：' + String(error && error.message ? error.message : error) })
          }
        }

        /** 试听：走服务端当前引擎合成，再播这个文件 */
        const testSpeak = async () => {
          if (auditioning) return
          setAuditioning(true)
          setMessage(undefined)
          try {
            const response = await fetch('/dsh-tts/api/test?text=' + encodeURIComponent(testText), { cache: 'no-store' })
            if (!response.ok) throw new Error('HTTP ' + response.status)
            const payload = await response.json()
            if (payload.error !== undefined) throw new Error(payload.error)
            if (typeof payload.url !== 'string' || payload.url === '') throw new Error('没有拿到音频')
            const result = await player.playOne({
              seq: -1,
              audioUrl: payload.url,
              text: testText,
              source: 'audition',
            })
            if (!result.ok) throw new Error(result.error || '播放失败')
            const sizeText = (typeof payload.size === 'number' && payload.size > 0 ? '，音频 ' + Math.round(payload.size / 1024) + 'KB' : '')
              + (typeof payload.durationMs === 'number' && payload.durationMs > 0 ? ' ' + (payload.durationMs / 1000).toFixed(1) + ' 秒' : '')
            setMessage({ ok: true, text: '试听（' + payload.provider + '）：已播放' + sizeText })
          } catch (error) {
            setMessage({ ok: false, text: '试听失败：' + String(error && error.message ? error.message : error) })
          } finally {
            setAuditioning(false)
          }
        }

        /** 清空待播队列：模型说太多时一键闭嘴 */
        const clearQueue = async () => {
          setMessage(undefined)
          try {
            const response = await fetch('/dsh-tts/api/clear', { cache: 'no-store' })
            if (!response.ok) throw new Error('HTTP ' + response.status)
            const payload = await response.json()
            setMessage({ ok: true, text: '已清空待播队列（丢掉 ' + String(payload.cleared ?? 0) + ' 条）' })
          } catch (error) {
            setMessage({ ok: false, text: '清空失败：' + String(error && error.message ? error.message : error) })
          }
        }

        if (state.phase === 'loading') return react.createElement('p', { style: style.hint }, '读取配置中…')
        if (state.phase === 'unsupported') {
          return react.createElement('div', { style: style.wrap },
            react.createElement('p', { style: style.hint }, '当前宿主没有暴露 settings Remote 域，无法在本页读写配置。'))
        }
        if (state.phase === 'missing') {
          return react.createElement('div', { style: style.wrap },
            react.createElement('p', { style: style.hint }, '宿主里没找到 dsh-tts 的配置条目。确认插件已安装并启用，再点重试。'),
            react.createElement('button', { style: style.btn, onClick: () => void load() }, '重试'))
        }
        if (state.phase === 'error') {
          return react.createElement('div', { style: style.wrap },
            react.createElement('p', { style: style.error }, '读取配置失败：' + state.error),
            react.createElement('button', { style: style.btn, onClick: () => void load() }, '重试'))
        }

        return react.createElement('div', { style: style.wrap },
          react.createElement('p', { style: style.hint },
            '默认 Edge TTS（免费免 key）；切火山方舟需要填它的 API Key。试听会用当前引擎真实合成；保存后 1~2 秒自动生效，不用重启。'),
          (() => {
            const visible = []
            let pending = null
            for (const field of fieldList) {
              if (field.section !== undefined) { pending = field; continue }
              if (field.dependsOn !== undefined) {
                const current = draft[field.dependsOn.key]
                // 配置还没读到时（undefined）先全部显示，读到后再收窄，避免一开始白屏
                if (current !== undefined && current !== field.dependsOn.equals) continue
              }
              if (pending !== null) { visible.push(pending); pending = null }
              visible.push(field)
            }
            return visible
          })().map((field) => {
            if (field.section !== undefined) {
              return react.createElement('div', {
                key: 'section:' + field.section,
                style: { marginTop: '18px', paddingTop: '10px', borderTop: '1px solid var(--dsw-alias-border-l1, #e5e5e5)' },
              }, react.createElement('div', {
                style: { fontWeight: 600, fontSize: '13px', color: 'var(--dsw-alias-label-secondary, #555)' },
              }, field.section))
            }
            return renderField(field, draft[field.key], (key, value) => {
              setDraft((previous) => {
                const nextDraft = Object.assign({}, previous)
                nextDraft[key] = value
                return nextDraft
              })
            })
          }),
          react.createElement('div', { style: style.row },
            react.createElement('label', { style: style.label }, '试听（走当前引擎）'),
            react.createElement('input', {
              style: style.input, value: testText,
              onChange: (event) => setTestText(event.target.value),
            }),
            react.createElement('div', { style: style.bar },
              react.createElement('button', { style: style.primary, onClick: () => void testSpeak() }, auditioning ? '合成中…' : '试听'))),
          react.createElement('div', { style: style.bar },
            react.createElement('button', { style: style.primary, onClick: () => void save() }, '保存'),
            react.createElement('button', { style: style.btn, onClick: () => void clearQueue() }, '清空待播队列'),
            message === undefined ? null
              : react.createElement('p', { style: message.ok ? style.ok : style.error }, message.text)))
      }

      const inject = ['slots', 'remote', 'remote.settings']

      function apply(ctx) {
        // 自动朗读的播放器必须随插件常驻启动：之前它只在设置面板 useMemo 里创建，
        // 面板没打开时队列根本没人拉取 → "试听能响、自动朗读不出声"（2026-11-17 定位）。
        let disposePlayer = null
        try {
          const player = ensurePlayer()
          player.start()
          const unlock = () => { player.kick() }
          document.addEventListener('pointerdown', unlock, { capture: true, once: true })
          disposePlayer = () => {
            document.removeEventListener('pointerdown', unlock, { capture: true })
            player.stop()
          }
        } catch (error) {
          console.warn('[dsh-tts] 全局播放器启动失败: ' + String(error && error.message ? error.message : error))
        }

        const Page = (props) => react.createElement(TtsSettingsPage, Object.assign({}, props, { ctx: ctx }))
        ctx.slots.inject('settings.section', () => ctx.slots.register({
          name: 'settings.section',
          id: 'tts',
          order: 66,
          label: () => '语音（TTS）',
        }, Page))

        return () => { if (typeof disposePlayer === 'function') disposePlayer() }
      }

      exports.apply = apply
      exports.inject = inject
      return module.exports
    },
  })
})()
