export function sanitizeForSpeech(input, options = {}) {
    // 统一策略：默认丢代码（见 SanitizeOptions.dropCode 的说明）
    const dropCode = options.dropCode !== false;
    let text = input;
    // 围栏代码块：保留内容
    text = dropCode
        ? text.replace(/```[a-zA-Z0-9+#-]*\n?[\s\S]*?```/g, ' ')
        : text.replace(/```[a-zA-Z0-9+#-]*\n?([\s\S]*?)```/g, '$1');
    // 行内代码
    text = dropCode
        ? text.replace(/`[^`]*`/g, ' ')
        : text.replace(/`([^`]*)`/g, '$1');
    // 图片/链接：[文字](url) → 文字；![alt](url) → 丢掉
    text = text.replace(/!\[[^\]]*\]\([^)]*\)/g, '');
    text = text.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1');
    // 裸 URL
    text = text.replace(/https?:\/\/[^\s)）】"']+/g, '');
    // Markdown 标题/引用/列表符号（行首）
    text = text.replace(/^\s{0,3}(#{1,6}|>|[-*+]|\d{1,2}[.)])\s+/gm, '');
    // 加粗/斜体/删除线标记
    text = text.replace(/(\*\*|__|\*|_|~~)/g, '');
    // 表格：先删分隔行（|---|---|），再把单元格拼成顿号分隔
    text = text.replace(/^\s*\|?[\s:|-]*\|[\s:|-]*$/gm, '');
    text = text.replace(/^\s*\|(.*)\|\s*$/gm, (_line, inner) => inner.split('|').map(cell => cell.trim()).filter(cell => cell !== '').join('，'));
    text = text.replace(/\s*\|\s*/g, '，');
    // 收掉连续/首尾逗号
    text = text.replace(/[，,]{2,}/g, '，').replace(/^[，,]+|[，,]+$/gm, '');
    // emoji 与杂符号
    text = text.replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{200D}]/gu, '');
    // 连续标点/空白
    text = text.replace(/[ \t]{2,}/g, ' ');
    text = text.replace(/\n{3,}/g, '\n\n');
    // 只剩标点的行丢掉
    text = text.split('\n').filter(line => /[\p{L}\p{N}]/u.test(line)).join('\n');
    return text.trim();
}
