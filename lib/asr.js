/**
 * 火山方舟 语音识别（ASR）v3 —— 单流模式（nostream，准确率优先）。
 *
 * 接口：wss://openspeech.bytedance.com/api/v3/plan/sauc/bigmodel_nostream
 * 鉴权：X-Api-Key（Agent Plan 专属 key，和 TTS 同一把） + X-Api-Resource-Id=volc.seedasr.sauc.duration
 *
 * 协议是**二进制帧**（大端）：
 *   [4 字节 header][可选 4 字节 sequence][4 字节 payload size][payload]
 *   header[0] = version(4) | headerSize(4) = 0x11
 *   header[1] = messageType(4) | flags(4)
 *   header[2] = serialization(4) | compression(4)
 *   header[3] = reserved
 * 客户端先发 full client request（JSON+gzip，带 seq=1），再发若干 audio only（gzip 音频），
 * 最后一包 flags=0b0010 表示结束；服务端在最后一包之后返回最终结果。
 */
import { gunzipSync, gzipSync } from 'node:zlib';
import { MiniWebSocket } from './ws.js';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
const MSG_FULL_CLIENT = 0b0001;
const MSG_AUDIO_ONLY = 0b0010;
const MSG_FULL_SERVER = 0b1001;
const MSG_ERROR = 0b1111;
const FLAG_NO_SEQ = 0b0000;
const FLAG_POS_SEQ = 0b0001;
const FLAG_LAST_NO_SEQ = 0b0010;
const FLAG_NEG_SEQ = 0b0011;
const SER_JSON = 0b0001;
const SER_NONE = 0b0000;
const COMP_GZIP = 0b0001;
function frame(messageType, flags, serialization, compression) {
    return Buffer.from([(1 << 4) | 1, (messageType << 4) | flags, (serialization << 4) | compression, 0]);
}
function withSequence(payload, sequence) {
    const head = Buffer.alloc(4);
    head.writeInt32BE(sequence, 0);
    const size = Buffer.alloc(4);
    size.writeUInt32BE(payload.length, 0);
    return Buffer.concat([head, size, payload]);
}
function withoutSequence(payload) {
    const size = Buffer.alloc(4);
    size.writeUInt32BE(payload.length, 0);
    return Buffer.concat([size, payload]);
}
function buildFullClientRequest(config) {
    const payload = gzipSync(Buffer.from(JSON.stringify(config), 'utf8'));
    return Buffer.concat([frame(MSG_FULL_CLIENT, FLAG_POS_SEQ, SER_JSON, COMP_GZIP), withSequence(payload, 1)]);
}
function buildAudioPacket(audio, sequence) {
    const payload = gzipSync(audio);
    const header = sequence === undefined
        ? frame(MSG_AUDIO_ONLY, FLAG_LAST_NO_SEQ, SER_NONE, COMP_GZIP)
        : frame(MSG_AUDIO_ONLY, FLAG_POS_SEQ, SER_NONE, COMP_GZIP);
    return Buffer.concat([header, sequence === undefined ? withoutSequence(payload) : withSequence(payload, sequence)]);
}
/** 解析服务端下发的一帧（连接关闭/半包时返回 undefined） */
export function parseFrame(data) {
    if (data.length < 4)
        return undefined;
    const headerSize = (data[0] ?? 0) & 0x0f;
    const type = (data[1] ?? 0) >> 4;
    const flags = (data[1] ?? 0) & 0x0f;
    const compression = (data[2] ?? 0) & 0x0f;
    let offset = headerSize * 4;
    let sequence;
    if (flags === FLAG_POS_SEQ || flags === FLAG_NEG_SEQ || (flags & 0b0011) === FLAG_POS_SEQ || (flags & 0b0011) === FLAG_NEG_SEQ) {
        if (data.length < offset + 4)
            return undefined;
        sequence = data.readInt32BE(offset);
        offset += 4;
    }
    if (type === MSG_ERROR) {
        if (data.length < offset + 8)
            return undefined;
        const code = data.readUInt32BE(offset);
        const size = data.readUInt32BE(offset + 4);
        offset += 8;
        return { type, flags, compression, sequence, payload: data.subarray(offset, offset + size), errorCode: code };
    }
    if (data.length < offset + 4)
        return undefined;
    const size = data.readUInt32BE(offset);
    offset += 4;
    const payload = data.subarray(offset, offset + size);
    return { type, flags, compression, sequence, payload };
}
function decodePayload(frameValue) {
    const raw = frameValue.compression === COMP_GZIP ? gunzipSync(frameValue.payload) : frameValue.payload;
    return raw.toString('utf8');
}
/** 一段音频（≤ chunkSeconds）走一次 nostream 请求 */
async function transcribeOnce(audio, options, log) {
    const endpoint = options.endpoint !== undefined && options.endpoint !== ''
        ? options.endpoint
        : 'wss://openspeech.bytedance.com/api/v3/plan/sauc/bigmodel_nostream';
    const resourceId = options.resourceId !== undefined && options.resourceId !== ''
        ? options.resourceId
        : 'volc.seedasr.sauc.duration';
    const format = options.format ?? 'mp3';
    return await new Promise((resolve, reject) => {
        let settled = false;
        let client;
        const finish = (error, text) => {
            if (settled)
                return;
            settled = true;
            try {
                client?.close();
            }
            catch {
                // 忽略
            }
            if (error !== undefined)
                reject(error);
            else
                resolve(text ?? '');
        };
        const timer = setTimeout(() => finish(new Error('ASR 超时（30s）')), 30_000);
        timer.unref?.();
        client = new MiniWebSocket({
            url: endpoint,
            headers: {
                'X-Api-Key': options.apiKey,
                'X-Api-Resource-Id': resourceId,
                'X-Api-Connect-Id': randomUUID(),
                'X-Control-Require-Usage-Tokens-Return': '*',
            },
            timeoutMs: 15_000,
        }, {
            onOpen: () => {
                client?.send(buildFullClientRequest({
                    user: { uid: 'dsh-tts' },
                    audio: {
                        format,
                        ...(options.language !== undefined && options.language !== '' ? { language: options.language } : {}),
                        ...(format === 'pcm' || format === 'wav' ? { rate: 16000, bits: 16, channel: 1 } : {}),
                    },
                    request: { model_name: 'bigmodel', enable_itn: true, enable_punc: true, result_type: 'full' },
                }));
                // 音频分包：8KB 一包（官方建议每包 100~200ms 音频），末日包标记结束
                const chunkSize = 8000;
                const chunks = [];
                for (let offset = 0; offset < audio.length; offset += chunkSize)
                    chunks.push(audio.subarray(offset, offset + chunkSize));
                if (chunks.length === 0)
                    chunks.push(Buffer.alloc(0));
                let index = 0;
                const sendNext = () => {
                    if (settled)
                        return;
                    const isLast = index === chunks.length - 1;
                    const chunk = chunks[index] ?? Buffer.alloc(0);
                    index += 1;
                    client?.send(buildAudioPacket(chunk, isLast ? undefined : index + 1));
                    if (isLast)
                        return;
                    setTimeout(sendNext, 60);
                };
                sendNext();
            },
            onMessage: (payload) => {
                const parsed = parseFrame(payload);
                if (parsed === undefined)
                    return;
                if (parsed.type === MSG_ERROR) {
                    let detail = '';
                    try {
                        detail = decodePayload(parsed);
                    }
                    catch {
                        detail = '';
                    }
                    finish(new Error('ASR 错误 ' + String(parsed.errorCode ?? '?') + (detail === '' ? '' : '：' + detail.slice(0, 200))));
                    return;
                }
                if (parsed.type !== MSG_FULL_SERVER)
                    return;
                let text = '';
                const isFinal = (parsed.flags & FLAG_NEG_SEQ) === FLAG_NEG_SEQ;
                try {
                    const json = JSON.parse(decodePayload(parsed));
                    text = json.result?.text ?? '';
                }
                catch (error) {
                    log?.('debug', 'ASR 结果解析失败: ' + (error instanceof Error ? error.message : String(error)));
                }
                if (isFinal || text !== '') {
                    clearTimeout(timer);
                    finish(undefined, text);
                }
            },
            onClose: (code, reason) => {
                if (!settled)
                    finish(new Error('ASR 连接被关闭（code ' + String(code) + (reason === '' ? '' : '，' + reason.slice(0, 120)) + '）'));
            },
            onError: (error) => finish(error),
        });
        client.connect();
    });
}
/**
 * 识别一段音频文件。
 * 超过 chunkSeconds（默认 12 秒，官方建议 ≤15 秒）就按字节切成几段分别识别再拼接。
 */
export async function transcribeAudio(path, options) {
    const started = Date.now();
    if (options.apiKey === '')
        throw new Error('没有配置 volcApiKey，无法做语音识别');
    const audio = await readFile(path);
    if (audio.length === 0)
        throw new Error('音频是空文件：' + path);
    const log = options.log ?? (() => { });
    // 只按大小粗分：mp3 约 8KB/秒（24kbps）。12 秒 ≈ 96KB，这里保守用 80KB
    const chunkBytes = Math.max(16_000, Math.round((options.chunkSeconds ?? 12) * 7000));
    let text = '';
    let utterances = 0;
    if (audio.length <= chunkBytes) {
        const result = await transcribeOnce(audio, options, log);
        text = result;
    }
    else {
        const total = Math.ceil(audio.length / chunkBytes);
        log('info', '音频较长（' + Math.round(audio.length / 1024) + 'KB），分 ' + String(total) + ' 段识别');
        for (let index = 0; index < total; index += 1) {
            const slice = audio.subarray(index * chunkBytes, (index + 1) * chunkBytes);
            try {
                const part = await transcribeOnce(slice, options, log);
                if (part.trim() !== '')
                    text += part;
            }
            catch (error) {
                log('warn', '第 ' + String(index + 1) + ' 段识别失败: ' + (error instanceof Error ? error.message : String(error)));
            }
        }
    }
    return { text: text.trim(), utterances, elapsedMs: Date.now() - started };
}
