/**
 * dsh-tts 配置（2026-11-05）。
 *
 * 设计原则：**引擎可换、凭据各自独立**，不外接任何不可替换的东西。
 *   provider: browser（浏览器朗读，零依赖）| edge（微软 Edge TTS，免费免 key）| volc（火山方舟，要凭据）
 */
import z from '@deepseek-ai/schemastery';
export interface ConfigShape {
    /** 引擎：browser / edge / volc */
    provider: string;
    /** 允许模型主动朗读 */
    enabled: boolean;
    /** Edge 音色自定义（选「自定义」时用） */
    edgeVoiceCustom: string;
    /** 火山音色自定义（选「自定义」时用） */
    volcSpeakerCustom: string;
    /** 队列上限 */
    queueSize: number;
    /** 单条最长字符（超出截断） */
    maxChars: number;
    /** 音频缓存目录（留空=$DSH_HOME/dsh-tts/audio） */
    audioDir: string;
    /** 最多保留多少音频文件 */
    audioKeep: number;
    /** Edge TTS 音色，如 zh-CN-XiaoxiaoNeural */
    edgeVoice: string;
    /** Edge 语速百分比（+20 = 快 20%） */
    edgeRatePercent: number;
    /** Edge 音高（Hz） */
    edgePitchHz: number;
    /** Edge 音量百分比 */
    edgeVolumePercent: number;
    /** 火山方舟「专属 API Key」 */
    volcApiKey: string;
    /** 资源 id（豆包语音合成 2.0 = seed-tts-2.0） */
    volcResourceId: string;
    /** 音色 speaker，如 zh_female_vv_uranus_bigtts */
    volcSpeaker: string;
    /** 输出格式 mp3 / wav / pcm */
    volcFormat: string;
    /** 采样率 */
    volcSampleRate: number;
    /** 接口地址（留空=官方 v3） */
    volcEndpoint: string;
    logLevel: 'debug' | 'info' | 'warn';
    /** 语音识别开关（火山 ASR，和 TTS 共用 volcApiKey） */
    asrEnabled: boolean;
    /** 识别资源 id：豆包流式语音识别 2.0 小时版 */
    asrResourceId: string;
    /** 音频容器格式 */
    asrFormat: 'mp3' | 'wav' | 'ogg' | 'pcm';
    /** 识别语言（空 = 自动） */
    asrLanguage: string;
    /** 单段识别上限（秒） */
    asrChunkSeconds: number;
    /** 自动朗读模型回复 */
    autoRead: boolean;
    /** 自动朗读时跳过哪些会话 id 前缀（逗号分隔，默认跳过 QQ 通道） */
    autoReadSkipPrefix: string;
}
export declare const Config: z<Schemastery.ObjectS<NoInfer<{
    provider: z<"edge" | "volc", "edge" | "volc", "volatile-defined">;
    enabled: z<boolean, boolean, "volatile-defined">;
    edgeVoiceCustom: z<string, string, "volatile-defined">;
    volcSpeakerCustom: z<string, string, "volatile-defined">;
    queueSize: z<number, number, "volatile-defined">;
    maxChars: z<number, number, "volatile-defined">;
    audioDir: z<string, string, "volatile-defined">;
    audioKeep: z<number, number, "volatile-defined">;
    edgeVoice: z<string, string, "volatile-defined">;
    edgeRatePercent: z<number, number, "volatile-defined">;
    edgePitchHz: z<number, number, "volatile-defined">;
    edgeVolumePercent: z<number, number, "volatile-defined">;
    volcApiKey: z<string, string, "volatile-defined">;
    volcResourceId: z<string, string, "volatile-defined">;
    volcSpeaker: z<string, string, "volatile-defined">;
    volcFormat: z<string, string, "volatile-defined">;
    volcSampleRate: z<number, number, "volatile-defined">;
    volcEndpoint: z<string, string, "volatile-defined">;
    logLevel: z<"debug" | "info" | "warn", "debug" | "info" | "warn", "defined">;
}>>, Schemastery.ObjectT<NoInfer<{
    provider: z<"edge" | "volc", "edge" | "volc", "volatile-defined">;
    enabled: z<boolean, boolean, "volatile-defined">;
    edgeVoiceCustom: z<string, string, "volatile-defined">;
    volcSpeakerCustom: z<string, string, "volatile-defined">;
    queueSize: z<number, number, "volatile-defined">;
    maxChars: z<number, number, "volatile-defined">;
    audioDir: z<string, string, "volatile-defined">;
    audioKeep: z<number, number, "volatile-defined">;
    edgeVoice: z<string, string, "volatile-defined">;
    edgeRatePercent: z<number, number, "volatile-defined">;
    edgePitchHz: z<number, number, "volatile-defined">;
    edgeVolumePercent: z<number, number, "volatile-defined">;
    volcApiKey: z<string, string, "volatile-defined">;
    volcResourceId: z<string, string, "volatile-defined">;
    volcSpeaker: z<string, string, "volatile-defined">;
    volcFormat: z<string, string, "volatile-defined">;
    volcSampleRate: z<number, number, "volatile-defined">;
    volcEndpoint: z<string, string, "volatile-defined">;
    logLevel: z<"debug" | "info" | "warn", "debug" | "info" | "warn", "defined">;
}>>, "plain">;
export declare const DEFAULTS: ConfigShape;
/**
 * 合并配置。
 *
 * 宿主传进来的值不一定干净（历史上遇到过 package.json 带 BOM、字段类型被写成数字等），
 * 所以这里按 DEFAULTS 的类型逐字段强制转换 —— 这样 `config.audioDir.trim()` 这类调用不会炸。
 */
export declare function resolveConfig(raw: Partial<ConfigShape> | undefined): ConfigShape;
