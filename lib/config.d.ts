/**
 * dsh-tts 配置（2026-11-05）。
 *
 * 设计原则：**不绑死任何一家引擎**。
 *   - `provider` 决定用哪个实现：`browser`（浏览器 speechSynthesis，零依赖、测试先跑通）
 *     或 `comfyui`（本机 ComfyUI 的音色）
 *   - 各 provider 自己的参数放自己的字段里，互不干扰
 */
import z from '@deepseek-ai/schemastery';
export interface ConfigShape {
    /** 引擎：browser / comfyui */
    provider: string;
    /** 允许模型主动朗读（关掉后 tts_speak 只排队不播） */
    enabled: boolean;
    /** 默认音量 0~1 */
    volume: number;
    /** 语速 0.5~2 */
    rate: number;
    /** 音高 0~2 */
    pitch: number;
    /** 语言（浏览器引擎用，如 zh-CN） */
    language: string;
    /** 指定音色名（浏览器引擎的 voice name，留空=按语言自动挑） */
    voice: string;
    /** 队列最多留多少条待播（浏览器轮询取走） */
    queueSize: number;
    /** 单条最长字符数（超了截断，防刷屏） */
    maxChars: number;
    /** ComfyUI 地址（provider=comfyui 时用） */
    comfyUrl: string;
    /** ComfyUI 里做 TTS 的工作流 id（provider=comfyui 时用） */
    comfyWorkflow: string;
    logLevel: 'debug' | 'info' | 'warn';
}
export declare const Config: z<Schemastery.ObjectS<NoInfer<{
    provider: z<"browser" | "comfyui", "browser" | "comfyui", "volatile-defined">;
    enabled: z<boolean, boolean, "volatile-defined">;
    volume: z<number, number, "volatile-defined">;
    rate: z<number, number, "volatile-defined">;
    pitch: z<number, number, "volatile-defined">;
    language: z<string, string, "volatile-defined">;
    voice: z<string, string, "volatile-defined">;
    queueSize: z<number, number, "volatile-defined">;
    maxChars: z<number, number, "volatile-defined">;
    comfyUrl: z<string, string, "volatile-defined">;
    comfyWorkflow: z<string, string, "volatile-defined">;
    logLevel: z<"debug" | "info" | "warn", "debug" | "info" | "warn", "defined">;
}>>, Schemastery.ObjectT<NoInfer<{
    provider: z<"browser" | "comfyui", "browser" | "comfyui", "volatile-defined">;
    enabled: z<boolean, boolean, "volatile-defined">;
    volume: z<number, number, "volatile-defined">;
    rate: z<number, number, "volatile-defined">;
    pitch: z<number, number, "volatile-defined">;
    language: z<string, string, "volatile-defined">;
    voice: z<string, string, "volatile-defined">;
    queueSize: z<number, number, "volatile-defined">;
    maxChars: z<number, number, "volatile-defined">;
    comfyUrl: z<string, string, "volatile-defined">;
    comfyWorkflow: z<string, string, "volatile-defined">;
    logLevel: z<"debug" | "info" | "warn", "debug" | "info" | "warn", "defined">;
}>>, "plain">;
export declare const DEFAULTS: ConfigShape;
export declare function resolveConfig(raw: Partial<ConfigShape> | undefined): ConfigShape;
