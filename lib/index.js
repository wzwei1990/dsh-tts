/**
 * dsh-tts：把文字变成声音（2026-11-05）。
 *
 * 引擎（provider 注册表，换引擎不动核心）：
 *   - edge   微软 Edge TTS：免费免 key，服务端合成 mp3（默认）
 *   - volc   火山方舟 TTS：要 appId/token，服务端合成 mp3
 *   - browser 浏览器 speechSynthesis：零依赖，前端直接念
 *
 * 服务端合成的音频落到 `$DSH_HOME/dsh-tts/audio/`，由 `/dsh-tts/audio/<file>` 提供；
 * 前端播放器轮询 `/dsh-tts/api/pending` 取到条目后：有 audioUrl 就播音频，没有就用 speechSynthesis。
 *
 * 对外契约：ctx.provide('dshTts', { speak, pending, cursor, clear, providers, status })
 */
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { AudioStore } from './audio.js';
import { Config, DEFAULTS, resolveConfig } from './config.js';
import { synthesizeEdge } from './edge.js';
import { LiveConfig } from './liveconfig.js';
import { UtteranceQueue } from './queue.js';
import { ProviderRegistry } from './providers.js';
import { registerTools } from './tools.js';
import { voicesFor } from './voices.js';
import { synthesizeVolc } from './volc.js';
export { Config };
export const name = 'dsh-tts';
/** tools 必备；webServer 用于挂 /dsh-tts/api（试听、待播队列、音频）。不 inject 的话宿主不会把 webServer 给我，路由就不存在 → 试听 404 */
export const inject = ['tools', 'webServer'];
const LEVEL_RANK = { debug: 0, info: 1, warn: 2 };
/** 音色解析：显式传参 > 自定义输入 > 下拉选择 */
function resolveVoice(explicit, selected, custom) {
    if (explicit !== undefined && explicit !== '')
        return explicit;
    if (selected === '__custom__')
        return custom.trim() !== '' ? custom.trim() : 'zh-CN-XiaoxiaoNeural';
    return selected;
}
function edgeProvider(queue, config, audio) {
    return {
        info: { id: 'edge', label: '微软 Edge TTS（免费免 key）', side: 'server' },
        async speak(text, options, utterance) {
            const cfg = config();
            const result = await synthesizeEdge(text, {
                voice: resolveVoice(options.voice, cfg.edgeVoice, cfg.edgeVoiceCustom),
                ratePercent: cfg.edgeRatePercent,
                pitchHz: cfg.edgePitchHz,
                volumePercent: cfg.edgeVolumePercent,
            });
            const saved = audio.save(result.audio, result.extension);
            const queued = queue.push({
                text,
                source: options.source ?? utterance.source,
                audioUrl: saved.url,
            });
            return {
                provider: 'edge',
                side: 'server',
                utterance: queued,
                audioUrl: saved.url,
                audioPath: audio.resolve(saved.file),
                note: '已合成 ' + String(Math.round(result.audio.length / 1024)) + 'KB 音频（' + cfg.edgeVoice + '），浏览器会播放',
            };
        },
    };
}
function volcProvider(queue, config, audio) {
    return {
        info: { id: 'volc', label: '火山方舟 TTS（豆包音色）', side: 'server' },
        async speak(text, options, utterance) {
            const cfg = config();
            const result = await synthesizeVolc(text, {
                apiKey: cfg.volcApiKey,
                resourceId: cfg.volcResourceId,
                speaker: resolveVoice(options.voice, cfg.volcSpeaker, cfg.volcSpeakerCustom),
                format: cfg.volcFormat,
                sampleRate: cfg.volcSampleRate,
                ...(cfg.volcEndpoint !== '' ? { endpoint: cfg.volcEndpoint } : {}),
            });
            const saved = audio.save(result.audio, result.extension);
            const queued = queue.push({
                text,
                source: options.source ?? utterance.source,
                audioUrl: saved.url,
            });
            return {
                provider: 'volc',
                side: 'server',
                utterance: queued,
                audioUrl: saved.url,
                audioPath: audio.resolve(saved.file),
                note: '已合成 ' + String(Math.round(result.audio.length / 1024)) + 'KB 音频（' + cfg.volcSpeaker + '），浏览器会播放',
            };
        },
    };
}
export function apply(ctx, rawConfig) {
    const initial = resolveConfig(rawConfig);
    const live = new LiveConfig({ initial, log: (level, message) => { if ((LEVEL_RANK[level] ?? 1) >= (LEVEL_RANK[initial.logLevel] ?? 1))
            console.log('[dsh-tts][' + level + '] ' + message); } });
    /** 每次调用都拿最新配置（宿主写回 YAML 后自动生效，不用重启） */
    const config = () => live.get();
    const threshold = LEVEL_RANK[initial.logLevel] ?? 1;
    const log = (level, message) => {
        if ((LEVEL_RANK[level] ?? 1) < threshold)
            return;
        const host = ctx;
        if (typeof host.logger === 'function')
            host.logger(level, '[dsh-tts] ' + message);
        else
            console.log('[dsh-tts][' + level + '] ' + message);
    };
    const dshHome = process.env.DSH_HOME !== undefined && process.env.DSH_HOME !== ''
        ? process.env.DSH_HOME
        : join(homedir(), '.dsh');
    const audioDir = initial.audioDir.trim() !== '' ? initial.audioDir.trim() : join(dshHome, 'dsh-tts', 'audio');
    const audio = new AudioStore({ dir: audioDir, keep: initial.audioKeep, log });
    const queue = new UtteranceQueue(initial.queueSize);
    const registry = new ProviderRegistry({ log });
    registry.register(edgeProvider(queue, config, audio));
    registry.register(volcProvider(queue, config, audio));
    const speak = async (text, options = {}) => {
        if (!config().enabled)
            throw new Error('TTS 已关闭（设置页 enabled）');
        const trimmed = text.trim();
        if (trimmed === '')
            throw new Error('要念的内容是空的');
        const clipped = trimmed.length > config().maxChars ? trimmed.slice(0, config().maxChars) + '…' : trimmed;
        const provider = registry.get(config().provider);
        if (provider === undefined) {
            throw new Error('没有这个 TTS 引擎：' + config().provider + '（可选：' + registry.list().map(item => item.id).join('/') + '）');
        }
        const placeholder = { seq: 0, text: clipped, source: options.source ?? 'agent', createdAt: Date.now() };
        const result = await provider.speak(clipped, options, placeholder);
        log('info', '朗读 ' + String(result.utterance.seq) + '：' + result.provider + ' ← ' + clipped.slice(0, 30));
        return result;
    };
    /** 只合成不入队：给 QQ 语音这类"自己拿文件去发"的消费者 */
    const synthesize = async (text, options = {}) => {
        const trimmed = text.trim();
        if (trimmed === '')
            throw new Error('要念的内容是空的');
        const clipped = trimmed.length > config().maxChars ? trimmed.slice(0, config().maxChars) + '…' : trimmed;
        const provider = registry.get(config().provider);
        if (provider === undefined)
            throw new Error('没有这个 TTS 引擎：' + config().provider);
        if (provider.info.side !== 'server') {
            throw new Error('引擎 ' + config().provider + ' 在浏览器里发声，拿不到音频文件；发 QQ 语音请用 edge 或 volc');
        }
        const placeholder = { seq: 0, text: clipped, source: options.source ?? 'agent', createdAt: Date.now() };
        const result = await provider.speak(clipped, options, placeholder);
        if (result.audioPath === undefined || result.audioUrl === undefined) {
            throw new Error('引擎 ' + config().provider + ' 没有产出音频文件');
        }
        // 合成专用不进队列：把刚入队的那条撤掉（避免浏览器又念一遍）
        queue.removeLast();
        return { path: result.audioPath, url: result.audioUrl, provider: config().provider };
    };
    const api = {
        speak,
        synthesize,
        pending: (since = 0) => queue.pending(since),
        cursor: () => queue.cursor(),
        clear: () => queue.clear(),
        providers: () => registry.list(),
        voices: (provider) => voicesFor(provider ?? config().provider),
        status: () => ({
            provider: config().provider,
            enabled: config().enabled,
            queue: queue.stats(),
            providers: registry.list(),
            audio: audio.stats(),
            audioDir: audio.dir(),
        }),
    };
    try {
        const host = ctx;
        host.provide?.('dshTts', api);
    }
    catch {
        log('debug', '宿主不支持 provide(dshTts)，跳过服务注册（工具仍可用）');
    }
    registerTools(ctx, { queue, registry, speak, status: api.status, log });
    // HTTP：待播队列 + 音频文件
    try {
        const web = ctx.webServer;
        if (web?.register !== undefined) {
            web.register({
                kind: 'prefix',
                path: '/dsh-tts/api',
                handler: (req, res) => {
                    const request = req;
                    const response = res;
                    const url = new URL('http://local' + (request.url ?? '/'));
                    const json = (payload) => {
                        response.setHeader?.('content-type', 'application/json; charset=utf-8');
                        response.setHeader?.('cache-control', 'no-store');
                        response.end?.(JSON.stringify(payload));
                    };
                    if (url.pathname === '/dsh-tts/api/pending') {
                        const since = Number(url.searchParams.get('since') ?? '0');
                        json(queue.pending(Number.isFinite(since) ? since : 0));
                        return;
                    }
                    if (url.pathname === '/dsh-tts/api/test') {
                        // 用当前引擎合成一句，返回音频地址（浏览器朗读则告诉前端自己念）
                        const text = url.searchParams.get('text') ?? '你好，这是语音试听。';
                        void (async () => {
                            try {
                                const provider = registry.get(config().provider);
                                if (provider === undefined || provider.info.side === 'client') {
                                    json({ browser: true, text });
                                    return;
                                }
                                const made = await synthesize(text, { source: 'audition' });
                                json({ url: made.url, provider: made.provider, text, size: (() => { try {
                                        return readFileSync(audio.resolve(made.url.split('/').pop() ?? '') ?? '').length;
                                    }
                                    catch {
                                        return 0;
                                    } })() });
                            }
                            catch (error) {
                                json({ error: error instanceof Error ? error.message : String(error) });
                            }
                        })();
                        return;
                    }
                    if (url.pathname === '/dsh-tts/api/voices') {
                        const provider = url.searchParams.get('provider') ?? config().provider;
                        json({ provider, voices: voicesFor(provider) });
                        return;
                    }
                    if (url.pathname === '/dsh-tts/api/info') {
                        json({ config: { ...config(), volcApiKey: config().volcApiKey === '' ? '' : '***' }, ...api.status() });
                        return;
                    }
                    response.statusCode = 404;
                    json({ error: 'not found' });
                },
            });
            web.register({
                kind: 'prefix',
                path: '/dsh-tts/audio',
                handler: (req, res) => {
                    const request = req;
                    const response = res;
                    const url = new URL('http://local' + (request.url ?? '/'));
                    const file = decodeURIComponent(url.pathname.replace('/dsh-tts/audio/', ''));
                    const full = audio.resolve(file);
                    if (full === undefined) {
                        response.writeHead?.(404, { 'content-type': 'text/plain; charset=utf-8' });
                        response.end?.('not found');
                        return;
                    }
                    // 宿主发文件的标准写法是 writeHead + end(buffer)（见 dsh-client-modules 发 bundle）。
                    // 之前用 createReadStream().pipe(res)：res 上没有 pipe 时什么都不发，连接就断（浏览器报 net::ERR_CONNECTION_CLOSED）。
                    try {
                        const body = readFileSync(full);
                        response.writeHead?.(200, {
                            'content-type': file.endsWith('.mp3') ? 'audio/mpeg' : 'application/octet-stream',
                            'content-length': String(body.length),
                            'cache-control': 'public, max-age=3600',
                            'accept-ranges': 'none',
                        });
                        response.end?.(body);
                    }
                    catch (error) {
                        response.writeHead?.(500, { 'content-type': 'text/plain; charset=utf-8' });
                        response.end?.('read failed: ' + (error instanceof Error ? error.message : String(error)));
                    }
                },
            });
            log('info', 'HTTP 已挂载：/dsh-tts/api/pending、/dsh-tts/audio（目录 ' + audioDir + '）');
        }
        else {
            log('warn', '宿主没有 webServer 服务：浏览器拿不到队列/音频（工具仍可用）');
        }
    }
    catch (error) {
        log('warn', '挂载 /dsh-tts 路由失败: ' + (error instanceof Error ? error.message : String(error)));
    }
    log('info', 'dsh-tts 已加载（引擎=' + config().provider + '，可用：' + registry.list().map(item => item.id).join('/') + '）');
    if (config().provider === 'volc' && config().volcApiKey === '') {
        log('warn', '引擎选了火山方舟，但 API Key 还没填，tts_speak 会失败');
    }
    if (config().provider === DEFAULTS.provider) {
        log('debug', '默认引擎 Edge TTS：免费免 key，直接能用');
    }
}
