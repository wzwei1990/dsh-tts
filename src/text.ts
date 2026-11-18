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
export interface SanitizeOptions {
  /**
   * 代码块/行内代码的**内容**要不要丢。
   *
   * 2026-11-17 起默认 **丢弃**（全链路统一）：桌宠朗读和 QQ 语音念代码都没有意义，
   * 而且代码会被 TTS 逐字符念成噪音。只有确实想让它念代码时才显式传 `{ dropCode: false }`。
   */
  dropCode?: boolean
}

export function sanitizeForSpeech(input: string, options: SanitizeOptions = {}): string {
  // 统一策略：默认丢代码（见 SanitizeOptions.dropCode 的说明）
  const dropCode = options.dropCode !== false
  let text = input
  // 围栏代码块：保留内容
  text = dropCode
    ? text.replace(/```[a-zA-Z0-9+#-]*\n?[\s\S]*?```/g, ' ')
    : text.replace(/```[a-zA-Z0-9+#-]*\n?([\s\S]*?)```/g, '$1')
  // 行内代码
  text = dropCode
    ? text.replace(/`[^`]*`/g, ' ')
    : text.replace(/`([^`]*)`/g, '$1')
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
  // 舞台提示与动作描写：这些是给"表演"看的，不该念出来（参考 dsh-her 的 speakable）
  //   〔开心〕〔动作:wave〕  性能标签：驱动身体，永不朗读
  //   【瞪他】               短方括号：舞台提示
  //   （笑）（跑了三条命令）  短圆括号：动作描写（≤8 字中文 / ≤12 字英文才删，长括号算正文）
  text = text.replace(/〔[^〕]*〕/g, ' ')
  text = text.replace(/【[^】]*】/g, ' ')
  text = text.replace(/（[^）]{1,8}）/g, ' ')
  text = text.replace(/\([^)]{1,12}\)/g, ' ')

  // emoji 与杂符号
  text = text.replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{200D}]/gu, '')
  // 连续标点/空白
  text = text.replace(/[ \t]{2,}/g, ' ')
  text = text.replace(/\n{3,}/g, '\n\n')
  // 只剩标点的行丢掉
  text = text.split('\n').filter(line => /[\p{L}\p{N}]/u.test(line)).join('\n')
  return text.trim()
}


/**
 * 切句：按中英文句末标点切，保留标点；过短的碎片（<6 字）并到下一句。
 * 逐句合成流水线用——第一句先合成就先播，长回复不必等整段。
 */
export function splitSentences(input: string): string[] {
  const text = input.trim()
  if (text === '') return []
  const parts = text.match(/[^。！？!?；;\n]+[。！？!?；;]?/gu) ?? [text]
  const out: string[] = []
  let buffer = ''
  for (const raw of parts) {
    const piece = raw.trim()
    if (piece === '') continue
    buffer = buffer === '' ? piece : buffer + piece
    if (buffer.length >= 4) {
      out.push(buffer)
      buffer = ''
    }
  }
  if (buffer !== '') {
    // 末尾碎片：太短（<2 字）就并到上一句，否则单独成句
    if (out.length > 0 && buffer.length < 2) out[out.length - 1] += buffer
    else out.push(buffer)
  }
  return out
}
