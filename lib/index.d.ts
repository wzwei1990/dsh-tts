import type { Context } from '@deepseek-ai/cordis';
import { Config, type ConfigShape } from './config.js';
export { Config };
export declare const name = "dsh-tts";
export declare const inject: string[];
export declare function apply(ctx: Context, rawConfig: ConfigShape): void;
