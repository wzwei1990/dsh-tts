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
export function sanitizeForSpeech(input: string): string {
  let text = input
  // 围栏代码块：保留内容
  text = text.replace(/```[a-zA-Z0-9+#-]*\n?([\s\S]*?)```/g, '$1')
  // 行内代码
  text = text.replace(/`([^`]*)`/g, '$1')
  // 图片/链接：[文字](url) → 文字；![alt](url) → 丢掉
  text = text.replace(/!\[[^\]]*\]\([^)]*\)/g, '')
  text = text.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
  // 裸 URL
  text = text.replace(/https?:\/\/[^\s)）】"']+/g, '')
  // Markdown 标题/引用/列表符号（行首）
  text = text.replace(/^\s{0,3}(#{1,6}|>|[-*+]|\d{1,2}[.)])\s+/gm, '')
  // 加粗/斜体/删除线标记
  text = text.replace(/(\*\*|__|\*|_|~~)/g, '')
  // 表格：先删分隔行（|---|---|），再把单元格拼成顿号分隔
  text = text.replace(/^\s*\|?[\s:|-]*\|[\s:|-]*$/gm, '')
  text = text.replace(/^\s*\|(.*)\|\s*$/gm, (_line, inner: string) => inner.split('|').map(cell => cell.trim()).filter(cell => cell !== '').join('，'))
  text = text.replace(/\s*\|\s*/g, '，')
  // 收掉连续/首尾逗号
  text = text.replace(/[，,]{2,}/g, '，').replace(/^[，,]+|[，,]+$/gm, '')
  // emoji 与杂符号
  text = text.replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{200D}]/gu, '')
  // 连续标点/空白
  text = text.replace(/[ \t]{2,}/g, ' ')
  text = text.replace(/\n{3,}/g, '\n\n')
  // 只剩标点的行丢掉
  text = text.split('\n').filter(line => /[\p{L}\p{N}]/u.test(line)).join('\n')
  return text.trim()
}
