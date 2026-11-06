/**
 * 朗读前的文本清洗（2026-11-06）。
 *
 * 为什么要清洗：模型回复是 Markdown + emoji + 链接，直接送 TTS 会念出
 * 「星号星号」「https colon slash slash」这种东西。
 *
 * 规则（尽量保守，只删"念出来是噪音"的东西）：
 *   - 代码块 ``` / 行内代码 `x` → 保留文字，去反引号
 *   - Markdown 标记 # * _ > - [ ] ( ) 等 → 去掉标记、保留内容
 *   - URL / 裸域名 → 去掉（念网址没意义）
 *   - emoji / 特殊符号 → 去掉
 *   - 表格竖线、多余空行 → 压成顿号/空格
 *   - 只剩标点的行 → 丢掉
 */
export declare function sanitizeForSpeech(input: string): string;
