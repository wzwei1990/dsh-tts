# dsh-tts

给 DeepSeek Harness 一个"会说话"的能力：**引擎可换**、**免费能用**、**能和 QQ 语音串起来**。

## 引擎

| 引擎 | 费用 | 需要什么 | 出声位置 |
|---|---|---|---|
| **edge**（默认） | 免费、免 key | 无 | 服务端合成 mp3 → 浏览器播放 |
| **volc**（火山方舟 / 豆包语音合成 2.0） | 按量计费 | 方舟「专属 API Key」 | 服务端合成 mp3 → 浏览器播放 |
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
