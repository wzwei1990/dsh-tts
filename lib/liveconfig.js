/**
 * 配置热更新（2026-11-06）。
 *
 * 问题：宿主把设置写回 `profiles/<name>/cordis.patch.yml` 后，**不会重新 apply 插件**，
 * 而我们在 apply 时把 config 闭包住了 —— 于是"改了引擎/音色，试听还是老声音"。
 *
 * 做法：自己盯着那个 YAML 文件，改了就从磁盘重读 dsh-tts 这一块并合并进当前配置。
 * 只读我们自己的字段，不解析整个 YAML（避免依赖）；文件没变时零开销。
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { DEFAULTS, resolveConfig } from './config.js';
/** 在哪些位置找 profile 配置（与 dsh-bili 的 cookie 自愈同一套路径） */
function candidateFiles() {
    const homes = [
        process.env.DSH_HOME !== undefined && process.env.DSH_HOME !== '' ? process.env.DSH_HOME : '',
        join(homedir(), '.dsh'),
    ].filter(home => home !== '');
    const files = [];
    for (const home of [...new Set(homes)]) {
        const profiles = join(home, 'profiles');
        if (!existsSync(profiles))
            continue;
        let names = [];
        try {
            names = readdirSync(profiles);
        }
        catch {
            continue;
        }
        for (const name of names) {
            const file = join(profiles, name, 'cordis.patch.yml');
            if (existsSync(file))
                files.push(file);
        }
    }
    return files;
}
function unquote(value) {
    const trimmed = value.trim();
    if (trimmed === '""' || trimmed === "''")
        return '';
    if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
        return trimmed.slice(1, -1);
    }
    return trimmed;
}
/** 从一段 YAML 文本里抽出 `- id: dsh-tts` 块的 config（扁平键值） */
export function parseTtsBlock(text, pluginId = 'dsh-tts') {
    const lines = text.split(/\r?\n/);
    let start = -1;
    for (let i = 0; i < lines.length; i += 1) {
        const line = lines[i] ?? '';
        if (new RegExp('^\\s*-\\s*id:\\s*' + pluginId + '\\s*$').test(line)) {
            start = i;
            break;
        }
    }
    if (start < 0)
        return {};
    const result = {};
    for (let i = start + 1; i < Math.min(lines.length, start + 400); i += 1) {
        const line = lines[i] ?? '';
        if (/^\s*-\s*id:/.test(line))
            break;
        const match = /^\s{4,}([\w-]+):\s*(.*)$/.exec(line);
        if (match === null)
            continue;
        const key = match[1] ?? '';
        const value = match[2] ?? '';
        if (key === '')
            continue;
        result[key] = unquote(value);
    }
    return result;
}
/**
 * 会自己从磁盘刷新的配置。
 * `get()` 每次都尝试检查 mtime（最多 1 秒一次），文件变了就重读。
 */
export class LiveConfig {
    current;
    options;
    lastCheck = 0;
    file;
    mtime = 0;
    constructor(options) {
        this.options = options;
        this.current = options.initial;
        this.locate();
        // mtime 归零：让第一次 get() 就把磁盘上的值读进来
        // （否则 locate() 已经把 mtime 记成当前值，refresh() 会以为"没变化"而跳过）
        this.mtime = 0;
    }
    locate() {
        const files = candidateFiles();
        // 优先包含 dsh-tts 块的文件
        for (const file of files) {
            try {
                const text = readFileSync(file, 'utf8');
                if (text.includes('- id: dsh-tts')) {
                    this.file = file;
                    this.mtime = statSync(file).mtimeMs;
                    return;
                }
            }
            catch {
                // 忽略
            }
        }
    }
    /** 只读当前值 */
    peek() {
        return this.current;
    }
    /** 需要时刷新，返回最新配置 */
    get() {
        const now = Date.now();
        if (now - this.lastCheck >= 1000) {
            this.lastCheck = now;
            this.refresh();
        }
        return this.current;
    }
    refresh() {
        if (this.file === undefined)
            this.locate();
        const file = this.file;
        if (file === undefined || !existsSync(file))
            return;
        let mtime = 0;
        try {
            mtime = statSync(file).mtimeMs;
        }
        catch {
            return;
        }
        if (mtime === this.mtime)
            return;
        this.mtime = mtime;
        let text = '';
        try {
            text = readFileSync(file, 'utf8');
        }
        catch {
            return;
        }
        const block = parseTtsBlock(text);
        if (Object.keys(block).length === 0)
            return;
        const raw = { ...this.current };
        for (const [key, value] of Object.entries(block)) {
            if (!(key in DEFAULTS))
                continue;
            raw[key] = value;
        }
        const next = resolveConfig(raw);
        // 只有真的变了才打日志
        const changed = Object.keys(DEFAULTS)
            .filter(key => String(this.current[key]) !== String(next[key]));
        if (changed.length > 0) {
            this.current = next;
            this.options.log?.('info', '配置已从磁盘更新：' + changed.join(', '));
        }
    }
}
