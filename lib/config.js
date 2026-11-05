/**
 * dsh-tts 配置（2026-11-05）。
 *
 * 设计原则：**不绑死任何一家引擎**。
 *   - `provider` 决定用哪个实现：`browser`（浏览器 speechSynthesis，零依赖、测试先跑通）
 *     或 `comfyui`（本机 ComfyUI 的音色）
 *   - 各 provider 自己的参数放自己的字段里，互不干扰
 */
import z from '@deepseek-ai/schemastery';
export const Config = z.object({
    provider: z.union(['browser', 'comfyui']).default('browser')
        .description('语音引擎：browser=浏览器 speechSynthesis（零依赖，先用它）；comfyui=本机 ComfyUI 音色').volatile(),
    enabled: z.boolean().default(true)
        .description('允许模型调用 tts_speak 主动朗读').volatile(),
    volume: z.number().min(0).max(1).default(1)
        .description('音量 0~1').volatile(),
    rate: z.number().min(0.5).max(2).default(1)
        .description('语速 0.5~2').volatile(),
    pitch: z.number().min(0).max(2).default(1)
        .description('音高 0~2').volatile(),
    language: z.string().default('zh-CN')
        .description('浏览器引擎的语言（如 zh-CN / ja-JP / en-US）').volatile(),
    voice: z.string().default('')
        .description('浏览器引擎的音色名（留空=按语言自动挑）').volatile(),
    queueSize: z.natural().min(1).max(50).default(10)
        .description('待播队列长度上限').volatile(),
    maxChars: z.natural().min(20).max(2000).default(300)
        .description('单条最长字符数（超出截断）').volatile(),
    comfyUrl: z.string().default('http://127.0.0.1:8188')
        .description('ComfyUI 地址（provider=comfyui 时用）').volatile(),
    comfyWorkflow: z.string().default('')
        .description('ComfyUI 的 TTS 工作流 id（provider=comfyui 时用）').volatile(),
    logLevel: z.union(['debug', 'info', 'warn']).default('info'),
});
export const DEFAULTS = {
    provider: 'browser',
    enabled: true,
    volume: 1,
    rate: 1,
    pitch: 1,
    language: 'zh-CN',
    voice: '',
    queueSize: 10,
    maxChars: 300,
    comfyUrl: 'http://127.0.0.1:8188',
    comfyWorkflow: '',
    logLevel: 'info',
};
export function resolveConfig(raw) {
    const merged = { ...DEFAULTS };
    if (raw === undefined)
        return merged;
    for (const key of Object.keys(DEFAULTS)) {
        const value = raw[key];
        if (value !== undefined && value !== null && value !== '') {
            merged[key] = value;
        }
        else if (typeof DEFAULTS[key] === 'string' && typeof value === 'string') {
            merged[key] = value;
        }
    }
    return merged;
}
