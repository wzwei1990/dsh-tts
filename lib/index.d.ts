import type { Context } from '@deepseek-ai/cordis';
import { Config, type ConfigShape } from './config.js';
export { Config };
export declare const name = "dsh-tts";
/** tools 必备；webServer 用于挂 /dsh-tts/api（试听、待播队列、音频）。不 inject 的话宿主不会把 webServer 给我，路由就不存在 → 试听 404 */
export declare const inject: string[];
export declare function apply(ctx: Context, rawConfig: ConfigShape): void;
