# dsh-tts

给 DeepSeek Harness 一个"会说话"的能力：**引擎可换**、**免费能用**、**能和 QQ 语音串起来**。

## 引擎

| 引擎 | 费用 | 需要什么 | 出声位置 |
|---|---|---|---|
| **edge**（默认） | 免费、免 key | 无 | 服务端合成 mp3 → 浏览器播放 |
| **volc**（火山方舟 / 豆包语音合成 2.0） | 按量计费 | 方舟「专属 API Key」 | 服务端合成 mp3 → 浏览器播放 |
| **deepseek**（官方语音 API，2026-11-13 开放） | TTS 限时 5 折 ¥1.5/万计费字符（中文 1 字 = 2 计费字符）；ASR ¥0.39/小时 | DeepSeek API Key（设置页 `deepseekApiKey` 或环境变量 `DEEPSEEK_API_KEY`） | 服务端合成 **wav** → 浏览器播放 |
| **browser** | 免费 | 无 | 浏览器本地 `speechSynthesis` |

## 安装

```bash
dsh plugin add github:wzwei1990/dsh-tts
# 重启 DSH
```

装完设置页多一个 **「语音（TTS）」** 段。

## 三条使用路径

### 1. 模型说话（浏览器播放）

```
模型调 tts_speak("你好呀")
  → 服务端合成 mp3（edge/volc）或入队（browser）
  → 浏览器轮询 /dsh-tts/api/pending
  → 有 audioUrl 就 <audio> 播放，没有就 speechSynthesis
```

### 2. 发 QQ 语音（配 dsh-napcat）

```
napcat_send_voice(text: "晚上好呀")
  → ctx.get('dshTts').synthesize(text)  → 音频文件路径
  → OneBot record 段（base64）→ QQ 群/私聊
```

需要 dsh-tts 引擎是 **edge 或 volc**（浏览器引擎没有音频文件）。

### 3. 手动试听

设置页「试听」按钮：本机浏览器直接念，用来挑音色。

## 工具

| 工具 | 插件 | 作用 |
|---|---|---|
| `tts_speak` | dsh-tts | 把文字念出来（入队给浏览器播） |
| `tts_status` | dsh-tts | 当前引擎、队列、音频缓存 |
| `tts_clear` | dsh-tts | 清空待播队列 |
| `napcat_send_voice` | dsh-napcat | 合成并发送 QQ 语音 |

## 服务接口（给其他插件）

```ts
const tts = ctx.get('dshTts')
await tts.speak('说一句', { source: 'live' })        // 入队 → 浏览器播
const { path } = await tts.synthesize('说一句')      // 只要音频文件（QQ 语音等）
tts.pending(since)                                   // { items, cursor }
tts.status()
```

`pending()` 每条就是 `dshTts/audio` 载荷：

```ts
{ seq, text, source, audioUrl?, createdAt }
```

## 配置（设置页）

| 字段 | 默认 | 说明 |
|---|---|---|
| `provider` | `edge` | edge / volc / browser |
| `enabled` | true | 允许模型主动朗读 |
| `maxChars` | 300 | 单条最长字符（超出截断） |
| `queueSize` | 10 | 待播队列上限 |
| `audioKeep` | 200 | 音频文件保留条数（超出删最旧） |
| `edgeVoice` | `zh-CN-XiaoxiaoNeural` | Edge 音色 |
| `edgeRatePercent` / `edgePitchHz` / `edgeVolumePercent` | 0 | Edge 语速/音高/音量 |
| `volcApiKey` | 空 | 火山方舟「专属 API Key」 |
| `volcResourceId` | `seed-tts-2.0` | 豆包语音合成 2.0 |
| `volcSpeaker` | `zh_female_vv_uranus_bigtts` | 火山音色 |
| `volcFormat` / `volcSampleRate` | mp3 / 24000 | 输出格式与采样率 |
| `language` / `voice` / `volume` / `rate` / `pitch` | zh-CN / 空 / 1 / 1 / 1 | 浏览器引擎参数 |

## 接口说明

**Edge TTS**：走 Edge 浏览器"朗读"的 WebSocket 协议，当前可用端点是
`wss://api.msedgeservices.com/tts/cognitiveservices/websocket/v1`，需要
`Ocp-Apim-Subscription-Key`（公开 token）+ `Sec-MS-GEC`（时间窗口签名）+ `Sec-MS-GEC-Version`。
音频帧格式：2 字节大端头长度 + 头部文本 + mp3 数据。遇到 429 会自动重试两次。

**火山方舟**：按官方 Agent Plan 文档的 v3 HTTP 单流接口
`POST https://openspeech.bytedance.com/api/v3/plan/tts/unidirectional`，
请求头 `X-Api-Key` / `X-Api-Resource-Id: seed-tts-2.0`，body `{ req_params: { text, speaker, audio_params } }`，
响应是流式 JSON 行（`code: 0` 带 base64 音频，`code: 20000000` 结束）。
参考：<https://docs.volcengine.com/docs/ark/agent-plan-personal-voice-model>

## 路线

- [x] 引擎注册表 + 待播队列 + 音频仓 + 三引擎（edge / volc / browser）
- [x] QQ 语音（`napcat_send_voice`，与 dsh-napcat 组合）
- [ ] 口型数据（visemes），给桌宠精确对口型
- [ ] 多音色档案（每个角色一个声线）

## 许可

MIT

## DeepSeek 官方语音（TTS / ASR）

官方 2026-11-13 开放的语音接口已接入（[TTS 文档](https://api-docs.deepseek.com/zh-cn/guides/tts) / [ASR 文档](https://api-docs.deepseek.com/zh-cn/guides/asr)）。

**TTS**

| 项 | 说明 |
| --- | --- |
| 端点 | `POST https://api.deepseek.com/v1/tools/tts` |
| 音色 | 只有 `stella`（女，默认）/ `tide`（男）；**无情感、无语速、无克隆** |
| 语种 | 普通话/粤语/英/日/韩/马来/阿拉伯/印尼/泰/越，按文本自动识别（无语言参数） |
| 上限 | 单请求 ≤1 万**计费字符**（中文按 2 计）、请求体 ≤64 KiB、单请求最多 30 分钟音频 |
| 输出 | 插件内统一用 `format=pcm` 分片请求 → 拼成一个 **WAV**（24kHz/16bit/单声道） |
| 计费 | 刊例 ¥3/万计费字符，限时 5 折 ¥1.5 |

**ASR**（设置页 `asrProvider=deepseek` 切换）

| 项 | 说明 |
| --- | --- |
| 端点 | `POST https://api.deepseek.com/v1/tools/asr`（multipart `file`） |
| 输入 | 16 位 PCM WAV 或 Ogg Opus；插件内先用 ffmpeg 统一转 16k 单声道 WAV |
| 上限 | **≤120 秒 / ≤8 MiB**；超长自动按 110 秒切片，逐段识别后拼接文本 |
| 输出 | `{ text, duration_ms }`，**无时间戳、无说话人** → 字幕/逐句对齐仍请用 `asrProvider=volc` |
| 计费 | 刊例 ¥0.78/小时，限时 5 折 ¥0.39 |

**注意**

- `asrProvider` 与 TTS 的 `provider` 相互独立：可以「火山 TTS + DeepSeek ASR」混搭。
- DeepSeek TTS 输出 wav，`tts` 的时长解析已支持 wav 头；QQ 语音发送若要求 mp3/amr，仍建议保留 edge/volc。
- 429/503/504 会直接抛错并带原因，由调用方决定是否回落到其它引擎。
