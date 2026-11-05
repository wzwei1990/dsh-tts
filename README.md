# dsh-tts

给 DeepSeek Harness 一个"会说话"的能力：**引擎可换**、**零依赖能用**、**给桌宠/直播留接口**。

## 为什么单独一个插件

语音会被很多地方用：QQ 语音、桌宠口型、直播配音。所以它不做成某个插件的附属功能，而是：

```
dsh-tts（核心：引擎注册表 + 待播队列）
  ├ browser 引擎  浏览器 speechSynthesis（零依赖，默认）
  └ comfyui 引擎  本机 ComfyUI 音色（要配工作流）
        ↓ 待播队列 /dsh-tts/api/pending
  消费者：浏览器播放器、桌宠（口型）、直播舞台
```

## 安装

```bash
dsh plugin add github:wzwei1990/dsh-tts
# 重启 DSH
```

装完在设置页会出现 **「语音（TTS）」** 段。

## 两条链路

### 1. 模型主动说话（服务端 → 浏览器）

```
模型调 tts_speak("你好呀") → 入队 → 浏览器轮询 /dsh-tts/api/pending → speechSynthesis 念出来
```

念的时候浏览器会派发 `dsh-tts:speak` 事件（`detail` = 这条 utterance），桌宠可以监听它做口型。

### 2. 手动试听（纯前端）

设置页的「试听」按钮直接在本机浏览器念，不经过模型和队列。

## 工具

| 工具 | 作用 |
|---|---|
| `tts_speak` | 把一段文字念出来（可传 `source` 让下游区分语气） |
| `tts_status` | 看当前引擎、队列长度、可用引擎 |
| `tts_clear` | 清空待播队列 |

## 服务接口（给其他插件）

```ts
const tts = ctx.get('dshTts')
await tts.speak('观众说想听你唱歌', { source: 'live' })   // 入队
tts.pending(since)   // { items, cursor }  浏览器/桌宠/舞台取用
tts.status()
```

`pending()` 返回的每条就是一个 `dshTts/audio` 载荷：

```ts
{ seq, text, source, rate, pitch, volume, language, voice, createdAt }
```

## 配置（设置页同名）

| 字段 | 默认 | 说明 |
|---|---|---|
| `provider` | `browser` | 引擎：browser / comfyui |
| `enabled` | true | 允许模型主动朗读 |
| `language` | `zh-CN` | 浏览器引擎语言 |
| `voice` | 空 | 音色名（留空按语言自动挑） |
| `volume` / `rate` / `pitch` | 1 / 1 / 1 | 音量、语速、音高 |
| `maxChars` | 300 | 单条最长字符（超出截断） |
| `queueSize` | 10 | 待播队列上限（满了丢最旧） |
| `comfyUrl` | `http://127.0.0.1:8188` | ComfyUI 地址 |
| `comfyWorkflow` | 空 | ComfyUI 的 TTS 工作流 id |

## 路线（未完成）

- [x] 引擎注册表 + 待播队列 + 浏览器引擎 + 工具
- [ ] ComfyUI 引擎真正出音频（现在只到"配置检查"）
- [ ] Edge TTS 引擎（免 key，音色多）
- [ ] 音频文件缓存与 `/dsh-tts/audio/<id>.wav` 静态服务
- [ ] 口型数据（visemes）输出，给桌宠精确对口型

## 许可

MIT
