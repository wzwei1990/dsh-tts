/**
 * dsh-tts 配置（2026-11-05）。
 *
 * 设计原则：**引擎可换、凭据各自独立**，不外接任何不可替换的东西。
 *   provider: browser（浏览器朗读，零依赖）| edge（微软 Edge TTS，免费免 key）| volc（火山方舟，要凭据）
 */
import z from '@deepseek-ai/schemastery';
export const Config = z.object({
    provider: z.union(['edge', 'volc']).default('edge')
        .description('语音引擎：edge=微软 Edge TTS（免费免 key，默认）；browser=浏览器本地朗读；volc=火山方舟（要 appId/token）').volatile(),
    enabled: z.boolean().default(true)
        .description('允许模型调用 tts_speak 主动朗读').volatile(),
    edgeVoiceCustom: z.string().default('')
        .description('Edge 音色自定义（edgeVoice 选「自定义」时用，如 zh-CN-XiaoxiaoNeural）').volatile(),
    volcSpeakerCustom: z.string().default('')
        .description('火山音色自定义（volcSpeaker 选「自定义」时用，如 zh_female_vv_uranus_bigtts）').volatile(),
    queueSize: z.natural().min(1).max(50).default(10)
        .description('待播队列长度上限').volatile(),
    maxChars: z.natural().min(20).max(2000).default(300)
        .description('单条最长字符数（超出截断）').volatile(),
    audioDir: z.string().default('')
        .description('音频缓存目录（留空=$DSH_HOME/dsh-tts/audio）').volatile(),
    audioKeep: z.natural().min(0).max(5000).default(200)
        .description('最多保留多少条音频文件（超出删最旧，0=不限）').volatile(),
    edgeVoice: z.string().default('zh-CN-XiaoxiaoNeural')
        .description('Edge 音色（如 zh-CN-XiaoxiaoNeural / zh-CN-YunxiNeural / ja-JP-NanamiNeural）').volatile(),
    edgeRatePercent: z.number().min(-50).max(100).default(0)
        .description('Edge 语速百分比（+20 = 快 20%）').volatile(),
    edgePitchHz: z.number().min(-50).max(50).default(0)
        .description('Edge 音高（Hz，正数更高）').volatile(),
    edgeVolumePercent: z.number().min(-50).max(100).default(0)
        .description('Edge 音量百分比（默认 0 = 原始音量）').volatile(),
    volcApiKey: z.string().role('secret').default('')
        .description('火山方舟「专属 API Key」（控制台 → Agent Plan → API Key）').volatile(),
    volcResourceId: z.string().default('seed-tts-2.0')
        .description('资源 id：豆包语音合成 2.0 用 seed-tts-2.0').volatile(),
    volcSpeaker: z.string().default('zh_female_vv_uranus_bigtts')
        .description('音色 speaker（如 zh_female_vv_uranus_bigtts / zh_female_gaolengyujie_uranus_bigtts）').volatile(),
    volcFormat: z.string().default('mp3')
        .description('输出格式：mp3 / wav / pcm').volatile(),
    volcSampleRate: z.natural().min(8000).max(48000).default(24000)
        .description('采样率（默认 24000）').volatile(),
    volcEndpoint: z.string().default('')
        .description('接口地址（留空=官方 /api/v3/plan/tts/unidirectional）').volatile(),
    logLevel: z.union(['debug', 'info', 'warn']).default('info'),
});
export const DEFAULTS = {
    provider: 'edge',
    enabled: true,
    edgeVoiceCustom: '',
    volcSpeakerCustom: '',
    queueSize: 10,
    maxChars: 300,
    audioDir: '',
    audioKeep: 200,
    edgeVoice: 'zh-CN-XiaoxiaoNeural',
    edgeRatePercent: 0,
    edgePitchHz: 0,
    edgeVolumePercent: 0,
    volcApiKey: '',
    volcResourceId: 'seed-tts-2.0',
    volcSpeaker: 'zh_female_vv_uranus_bigtts',
    volcFormat: 'mp3',
    volcSampleRate: 24000,
    volcEndpoint: '',
    logLevel: 'info',
};
export function resolveConfig(raw) {
    const merged = { ...DEFAULTS };
    if (raw === undefined)
        return merged;
    for (const key of Object.keys(DEFAULTS)) {
        const value = raw[key];
        if (value !== undefined && value !== null)
            merged[key] = value;
    }
    return merged;
}
