/**
 * 模型侧工具（2026-11-05）：
 *   - tts_speak：把一段文字交给语音引擎念出来
 *   - tts_status：看当前引擎、队列长度、可用引擎
 *   - tts_clear：清空待播队列（不想让它把积压的话一次念完）
 *   - tts_transcribe：把一段音频（QQ 语音等）转成文字（火山 ASR）
 */
import type { Context } from '@deepseek-ai/cordis';
import type { UtteranceQueue } from './queue.js';
import type { ProviderRegistry, SpeakResult } from './providers.js';
export interface ToolDeps {
    queue: UtteranceQueue;
    registry: ProviderRegistry;
    speak: (text: string, options?: {
        rate?: number;
        volume?: number;
        pitch?: number;
        language?: string;
        voice?: string;
        source?: string;
    }) => Promise<SpeakResult>;
    status: () => {
        provider: string;
        enabled: boolean;
        queue: {
            length: number;
            seq: number;
            dropped: number;
        };
        providers: Array<{
            id: string;
            label: string;
            side: string;
        }>;
    };
    log: (level: 'debug' | 'info' | 'warn', message: string) => void;
    /** 语音识别（火山 ASR）：音频文件 → 文本 */
    transcribe: (path: string, options?: {
        language?: string;
    }) => Promise<{
        text: string;
        elapsedMs: number;
        provider: string;
    }>;
}
export declare function registerTools(ctx: Context, deps: ToolDeps): void;
