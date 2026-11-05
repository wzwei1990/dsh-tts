import { Config, DEFAULTS, resolveConfig } from './config.js';
import { UtteranceQueue } from './queue.js';
import { ProviderRegistry } from './providers.js';
import { registerTools } from './tools.js';
export { Config };
export const name = 'dsh-tts';
/** tools 必填；webServer 用于浏览器轮询待播队列（拿不到就退化成"只出状态"） */
export const inject = ['tools'];
const LEVEL_RANK = { debug: 0, info: 1, warn: 2 };
/** 浏览器念：入队等前端取 */
function browserProvider(queue, config) {
    return {
        info: { id: 'browser', label: '浏览器朗读（speechSynthesis）', side: 'client' },
        async speak(text, options, utterance) {
            const cfg = config();
            const queued = queue.push({
                text,
                source: options.source ?? utterance.source,
                volume: options.volume ?? cfg.volume,
                rate: options.rate ?? cfg.rate,
                pitch: options.pitch ?? cfg.pitch,
                language: options.language ?? cfg.language,
                ...(options.voice !== undefined && options.voice !== '' ? { voice: options.voice } : (cfg.voice !== '' ? { voice: cfg.voice } : {})),
            });
            return {
                provider: 'browser',
                side: 'client',
                utterance: queued,
                note: '已排进朗读队列（第 ' + String(queued.seq) + ' 条），浏览器打开 DSH 就会念',
            };
        },
    };
}
/** ComfyUI 念：服务端生成音频（未配置工作流时给出明确错误） */
function comfyProvider(config, log) {
    return {
        info: { id: 'comfyui', label: 'ComfyUI 音色', side: 'server' },
        async speak(_text, _options, utterance) {
            const cfg = config();
            if (cfg.comfyWorkflow.trim() === '') {
                throw new Error('还没配置 ComfyUI 的 TTS 工作流（设置页 comfyWorkflow），暂时用 provider=browser');
            }
            log('info', 'ComfyUI TTS 尚未接线，请求已记录（seq ' + String(utterance.seq) + '）');
            throw new Error('ComfyUI TTS 还没接线：先把工作流配置好，下一版实现出音频文件');
        },
    };
}
export function apply(ctx, rawConfig) {
    const config = resolveConfig(rawConfig);
    const threshold = LEVEL_RANK[config.logLevel] ?? 1;
    const log = (level, message) => {
        if ((LEVEL_RANK[level] ?? 1) < threshold)
            return;
        const host = ctx;
        if (typeof host.logger === 'function')
            host.logger(level, '[dsh-tts] ' + message);
        else
            console.log('[dsh-tts][' + level + '] ' + message);
    };
    const queue = new UtteranceQueue(config.queueSize);
    const registry = new ProviderRegistry({ log });
    registry.register(browserProvider(queue, () => config));
    registry.register(comfyProvider(() => config, log));
    /** 统一的说话入口：截断 + 选引擎 */
    const speak = async (text, options = {}) => {
        if (!config.enabled)
            throw new Error('TTS 已关闭（设置页 enabled）');
        const trimmed = text.trim();
        if (trimmed === '')
            throw new Error('要念的内容是空的');
        const clipped = trimmed.length > config.maxChars ? trimmed.slice(0, config.maxChars) + '…' : trimmed;
        const provider = registry.get(config.provider);
        if (provider === undefined)
            throw new Error('没有这个 TTS 引擎：' + config.provider + '（可选：' + registry.list().map(item => item.id).join('/') + '）');
        const placeholder = {
            seq: 0,
            text: clipped,
            source: options.source ?? 'agent',
            createdAt: Date.now(),
        };
        const result = await provider.speak(clipped, options, placeholder);
        log('info', '朗读 ' + String(result.utterance.seq) + '：' + result.provider + ' ← ' + clipped.slice(0, 30));
        return result;
    };
    const api = {
        speak,
        pending: (since = 0) => queue.pending(since),
        cursor: () => queue.cursor(),
        clear: () => queue.clear(),
        providers: () => registry.list(),
        status: () => ({ provider: config.provider, enabled: config.enabled, queue: queue.stats(), providers: registry.list() }),
    };
    // 给渠道/桌宠/直播插件用（与 dsh-bili 的 dshBili 同一种形态）
    try {
        const host = ctx;
        host.provide?.('dshTts', api);
    }
    catch {
        log('debug', '宿主不支持 provide(dshTts)，跳过服务注册（工具仍可用）');
    }
    registerTools(ctx, { queue, registry, speak, status: api.status, log });
    // 浏览器轮询：GET /dsh-tts/api/pending?since=N → { items, cursor }
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
                    const respond = (payload) => {
                        response.setHeader?.('content-type', 'application/json; charset=utf-8');
                        response.setHeader?.('cache-control', 'no-store');
                        response.end?.(JSON.stringify(payload));
                    };
                    if (url.pathname === '/dsh-tts/api/pending') {
                        const since = Number(url.searchParams.get('since') ?? '0');
                        respond(queue.pending(Number.isFinite(since) ? since : 0));
                        return;
                    }
                    if (url.pathname === '/dsh-tts/api/info') {
                        respond({ config: { ...config }, ...api.status() });
                        return;
                    }
                    response.statusCode = 404;
                    respond({ error: 'not found' });
                },
            });
            log('info', '浏览器轮询已挂载：/dsh-tts/api/pending');
        }
        else {
            log('warn', '宿主没有 webServer 服务：浏览器朗读拿不到队列（工具仍可用）');
        }
    }
    catch (error) {
        log('warn', '挂载 /dsh-tts/api 失败: ' + (error instanceof Error ? error.message : String(error)));
    }
    log('info', 'dsh-tts 已加载（引擎=' + config.provider + '，可用：' + registry.list().map(item => item.id).join('/') + '；最长 ' + String(config.maxChars) + ' 字）');
    if (config.provider === DEFAULTS.provider) {
        log('debug', '默认引擎是浏览器朗读：不需要任何外部依赖，打开网页就能出声');
    }
}
