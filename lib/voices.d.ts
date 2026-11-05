/**
 * 音色目录（2026-11-05）。
 *
 * 来源：
 *   - Edge：官方 voices/list 接口实测可拉（322 个音色，其中 zh-CN 8 个）；内置常用清单做兜底。
 *   - 火山方舟：控制台 ListSpeakers 接口（ResourceID=seed-tts-2.0）实测拉取，共 472 个音色；
 *     这里收录「性别=女 + 中英混」的 54 个（用户在控制台就是这么筛的）。
 *     要别的音色，在下拉框选「自定义」填 voice_type 即可。
 */
export interface VoiceOption {
    /** 传给引擎的值 */
    id: string;
    /** 下拉框里显示的文字 */
    label: string;
    /** 语言/方言，便于分组 */
    locale?: string;
}
/** Edge 常用音色（实测自官方 voices/list） */
export declare const EDGE_VOICES: VoiceOption[];
/** 火山方舟「豆包语音合成 2.0」：性别=女 + 中英混（控制台 ListSpeakers 实测 54 个） */
export declare const VOLC_SPEAKERS: VoiceOption[];
export declare function voicesFor(provider: string): VoiceOption[];
