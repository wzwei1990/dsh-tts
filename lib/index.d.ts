/**
 * dsh-tts：把文字变成声音（2026-11-05 起步）。
 *
 * 架构（照官方 speech-to-text 的形态）：
 *   插件 → provider 注册表 → 具体引擎
 *   现在两个引擎：
 *     - browser（默认）：服务端把话入队，浏览器轮询取走后用 speechSynthesis 念
 *     - comfyui：服务端调本机 ComfyUI 生成音频（配置了工作流才启用）
 *
 * 对外契约：
 *   ctx.provide('dshTts', {
 *     speak(text, opts) → { provider, side, utterance }
 *     pending(since)    → { items, cursor }      // 给浏览器/桌宠/舞台取
 *     status()          → { providers, queue }
 *   })
 * 事件形态（后续插件订阅）：pending() 里的 items 就是 `dshTts/audio` 的载荷。
 */
import type { Context } from '@deepseek-ai/cordis';
import { Config, type ConfigShape } from './config.js';
export { Config };
export declare const name = "dsh-tts";
/** tools 必填；webServer 用于浏览器轮询待播队列（拿不到就退化成"只出状态"） */
export declare const inject: string[];
export declare function apply(ctx: Context, rawConfig: ConfigShape): void;
