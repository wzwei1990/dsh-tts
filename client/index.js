/**
 * dsh-tts 浏览器半边（手写客户端模块，免构建）。
 *
 * 两件事：
 *   1. 设置页「语音（TTS）」段：引擎/音量/语速/音色/队列
 *   2. **播放器**：轮询 /dsh-tts/api/pending，用 speechSynthesis 把话念出来
 *      （桌宠、直播舞台以后都从这里拿"她正在说什么"）
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

      const FIELDS = [
        { section: '引擎' },
        {
          key: 'provider',
          label: '语音引擎',
          kind: 'select',
          options: [['browser', '浏览器朗读（零依赖，先用它）'], ['comfyui', 'ComfyUI 音色（要配工作流）']],
          hint: '浏览器朗读不占显存、不需要装东西；ComfyUI 音色更接近"她的声音"，但要先配好工作流。',
        },
        { key: 'enabled', label: '允许模型主动朗读（tts_speak）', kind: 'boolean' },
        { key: 'maxChars', label: '单条最长字符数（超出截断）', kind: 'number', hint: '默认 300，防止一口气念太长' },
        { key: 'queueSize', label: '待播队列长度上限', kind: 'number', hint: '默认 10，满了丢最旧的' },

        { section: '声音' },
        { key: 'language', label: '语言（浏览器引擎）', kind: 'text', placeholder: 'zh-CN' },
        { key: 'voice', label: '音色名（留空=按语言自动挑）', kind: 'text', placeholder: '如 Microsoft Xiaoxiao Online (Natural) - Chinese (Mainland)' },
        { key: 'volume', label: '音量 0~1', kind: 'number', hint: '默认 1' },
        { key: 'rate', label: '语速 0.5~2', kind: 'number', hint: '默认 1' },
        { key: 'pitch', label: '音高 0~2', kind: 'number', hint: '默认 1' },

        { section: 'ComfyUI（provider=comfyui 时用）' },
        { key: 'comfyUrl', label: 'ComfyUI 地址', kind: 'text', placeholder: 'http://127.0.0.1:8188' },
        { key: 'comfyWorkflow', label: 'TTS 工作流 id', kind: 'text', hint: '留空则不能用 comfyui 引擎' },

        { section: '日志' },
        {
          key: 'logLevel',
          label: '日志级别',
          kind: 'select',
          options: [['info', 'info：只记关键事件'], ['debug', 'debug：每次朗读都打'], ['warn', 'warn：只记问题']],
        },
      ]

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

      /**
       * 播放器：轮询待播队列 → speechSynthesis 念。
       * 游标存 localStorage：刷新页面不会把历史重新念一遍。
       */
      function createPlayer() {
        let cursor = 0
        let timer
        let busy = false
        try {
          const stored = window.localStorage.getItem('dsh-tts:cursor')
          if (stored !== null) cursor = Number(stored) || 0
        } catch (error) { /* 隐私模式拿不到 localStorage，就用内存游标 */ }

        const saveCursor = (value) => {
          cursor = value
          try { window.localStorage.setItem('dsh-tts:cursor', String(value)) } catch (error) { /* 忽略 */ }
        }

        const pickVoice = (item) => {
          const synth = window.speechSynthesis
          if (!synth) return null
          const voices = synth.getVoices() || []
          if (item.voice) {
            const exact = voices.find((voice) => voice.name === item.voice)
            if (exact) return exact
          }
          const language = item.language || 'zh-CN'
          return voices.find((voice) => voice.lang === language)
            || voices.find((voice) => voice.lang && voice.lang.toLowerCase().startsWith(language.slice(0, 2).toLowerCase()))
            || null
        }

        const speakOne = (item) => new Promise((resolve) => {
          const synth = window.speechSynthesis
          if (!synth || typeof window.SpeechSynthesisUtterance === 'undefined') { resolve(); return }
          const utterance = new window.SpeechSynthesisUtterance(item.text)
          const voice = pickVoice(item)
          if (voice) utterance.voice = voice
          if (typeof item.language === 'string' && item.language !== '') utterance.lang = item.language
          if (typeof item.volume === 'number') utterance.volume = Math.max(0, Math.min(1, item.volume))
          if (typeof item.rate === 'number') utterance.rate = Math.max(0.5, Math.min(2, item.rate))
          if (typeof item.pitch === 'number') utterance.pitch = Math.max(0, Math.min(2, item.pitch))
          let settled = false
          const finish = () => { if (!settled) { settled = true; resolve() } }
          utterance.onend = finish
          utterance.onerror = finish
          // 兜底：某些浏览器不触发 onend（长文本/切标签页）
          const guard = setTimeout(finish, 60_000)
          utterance.addEventListener('end', () => clearTimeout(guard))
          try {
            window.dispatchEvent(new CustomEvent('dsh-tts:speak', { detail: item }))
            synth.speak(utterance)
          } catch (error) { clearTimeout(guard); finish() }
        })

        const tick = async () => {
          if (busy) return
          busy = true
          try {
            const response = await fetch('/dsh-tts/api/pending?since=' + String(cursor), { cache: 'no-store' })
            if (!response.ok) return
            const payload = await response.json()
            const items = Array.isArray(payload.items) ? payload.items : []
            if (items.length === 0) {
              if (typeof payload.cursor === 'number' && payload.cursor > cursor) saveCursor(payload.cursor)
              return
            }
            for (const item of items) {
              await speakOne(item)
              saveCursor(item.seq)
            }
          } catch (error) {
            // 服务端可能还没挂上路由：静默重试
          } finally {
            busy = false
          }
        }

        const start = () => {
          if (timer !== undefined) return
          timer = setInterval(() => { void tick() }, POLL_MS)
          void tick()
        }
        const stop = () => {
          if (timer !== undefined) { clearInterval(timer); timer = undefined }
        }
        return { start, stop, speakOne, getCursor: () => cursor, setCursor: saveCursor }
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
            id, type: 'text', style: style.input,
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
        const [testText, setTestText] = react.useState('你好呀，我是小灯，这是语音测试。')
        const player = react.useMemo(() => createPlayer(), [])

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
            for (const field of FIELDS) {
              if (!Object.prototype.hasOwnProperty.call(draft, field.key)) continue
              const value = draft[field.key]
              if (value === undefined) continue
              if (field.kind === 'number') { next[field.key] = Number(value); continue }
              if (field.kind === 'boolean') { next[field.key] = Boolean(value); continue }
              next[field.key] = value
            }
            await unwrap(await remote.settings.update(NS, next, row ? row.revision : revision))
            setMessage({ ok: true, text: '已保存（写入 profile 的 cordis.patch.yml，插件会热重载）' })
            await load()
          } catch (error) {
            setMessage({ ok: false, text: '保存失败：' + String(error && error.message ? error.message : error) })
          }
        }

        const testSpeak = () => {
          void player.speakOne({
            seq: -1,
            text: testText,
            language: draft.language || 'zh-CN',
            voice: draft.voice || undefined,
            volume: typeof draft.volume === 'number' ? draft.volume : 1,
            rate: typeof draft.rate === 'number' ? draft.rate : 1,
            pitch: typeof draft.pitch === 'number' ? draft.pitch : 1,
          })
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
            '浏览器朗读不需要任何依赖：模型调 tts_speak 后，这个页面会念出来。桌宠/直播以后都从这里拿"她在说什么"。'),
          FIELDS.map((field) => {
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
            react.createElement('label', { style: style.label }, '试听（直接用本机浏览器念，不经过模型）'),
            react.createElement('input', {
              style: style.input, value: testText,
              onChange: (event) => setTestText(event.target.value),
            }),
            react.createElement('div', { style: style.bar },
              react.createElement('button', { style: style.btn, onClick: testSpeak }, '试听'))
          ),
          react.createElement('div', { style: style.bar },
            react.createElement('button', { style: style.primary, onClick: () => void save() }, '保存'),
            react.createElement('button', { style: style.btn, onClick: () => { player.setCursor(0) } }, '重置播放游标'),
            react.createElement('button', { style: style.btn, onClick: () => void load() }, '重新读取'),
            message === undefined ? null
              : react.createElement('p', { style: message.ok ? style.ok : style.error }, message.text)))
      }

      const inject = ['slots', 'remote', 'remote.settings']

      function apply(ctx) {
        const Page = (props) => react.createElement(TtsSettingsPage, Object.assign({}, props, { ctx: ctx }))
        ctx.slots.inject('settings.section', () => ctx.slots.register({
          name: 'settings.section',
          id: 'tts',
          order: 66,
          label: () => '语音（TTS）',
        }, Page))
      }

      exports.apply = apply
      exports.inject = inject
      return module.exports
    },
  })
})()
