/**
 * 极简 WebSocket 客户端（只做我们需要的：wss + 二进制帧 + 自定义握手头）。
 *
 * 为什么不用全局 WebSocket：Node 内置的 undici WebSocket **不支持自定义请求头**
 * （new WebSocket(url, { headers }) 会被忽略），而火山 ASR 的鉴权全靠请求头
 * （X-Api-Key / X-Api-Resource-Id），用它必然握手失败、连接被关。
 *
 * 也不引第三方 ws：插件保持零依赖，离线也能装。
 * 只实现：握手、发送二进制帧（客户端掩码）、接收帧（含分片）、ping→pong、关闭。
 */
import { connect as netConnect } from 'node:net';
import { connect as tlsConnect } from 'node:tls';
import { randomBytes } from 'node:crypto';
const OP_CONT = 0x0;
const OP_TEXT = 0x1;
const OP_BINARY = 0x2;
const OP_CLOSE = 0x8;
const OP_PING = 0x9;
const OP_PONG = 0xa;
/** 把一段数据编成客户端帧（浏览器→服务端必须掩码） */
export function encodeFrame(payload, opcode = OP_BINARY) {
    const length = payload.length;
    let header;
    if (length < 126) {
        header = Buffer.from([0x80 | opcode, 0x80 | length]);
    }
    else if (length < 65536) {
        header = Buffer.alloc(4);
        header[0] = 0x80 | opcode;
        header[1] = 0x80 | 126;
        header.writeUInt16BE(length, 2);
    }
    else {
        header = Buffer.alloc(10);
        header[0] = 0x80 | opcode;
        header[1] = 0x80 | 127;
        header.writeBigUInt64BE(BigInt(length), 2);
    }
    const mask = randomBytes(4);
    const masked = Buffer.alloc(length);
    for (let index = 0; index < length; index += 1)
        masked[index] = (payload[index] ?? 0) ^ (mask[index % 4] ?? 0);
    return Buffer.concat([header, mask, masked]);
}
/** 从缓冲区里尽量多解析帧，返回帧数组与剩余字节 */
export function decodeFrames(buffer) {
    const frames = [];
    let offset = 0;
    while (offset + 2 <= buffer.length) {
        const first = buffer[offset] ?? 0;
        const second = buffer[offset + 1] ?? 0;
        const fin = (first & 0x80) !== 0;
        const opcode = first & 0x0f;
        const masked = (second & 0x80) !== 0;
        let length = second & 0x7f;
        let cursor = offset + 2;
        if (length === 126) {
            if (cursor + 2 > buffer.length)
                break;
            length = buffer.readUInt16BE(cursor);
            cursor += 2;
        }
        else if (length === 127) {
            if (cursor + 8 > buffer.length)
                break;
            length = Number(buffer.readBigUInt64BE(cursor));
            cursor += 8;
        }
        let maskKey;
        if (masked) {
            if (cursor + 4 > buffer.length)
                break;
            maskKey = buffer.subarray(cursor, cursor + 4);
            cursor += 4;
        }
        if (cursor + length > buffer.length)
            break;
        let payload = buffer.subarray(cursor, cursor + length);
        if (maskKey !== undefined) {
            const unmasked = Buffer.alloc(length);
            for (let index = 0; index < length; index += 1)
                unmasked[index] = (payload[index] ?? 0) ^ (maskKey[index % 4] ?? 0);
            payload = unmasked;
        }
        frames.push({ opcode: fin ? opcode : OP_CONT, payload });
        offset = cursor + length;
        if (!fin) {
            // 分片：把后续 continuation 拼起来（火山的下行帧都是单帧，这里只做兜底）
            let combined = payload;
            while (offset + 2 <= buffer.length) {
                const nextFirst = buffer[offset] ?? 0;
                const nextSecond = buffer[offset + 1] ?? 0;
                const nextOpcode = nextFirst & 0x0f;
                let nextLength = nextSecond & 0x7f;
                let nextCursor = offset + 2;
                if (nextLength === 126) {
                    if (nextCursor + 2 > buffer.length)
                        break;
                    nextLength = buffer.readUInt16BE(nextCursor);
                    nextCursor += 2;
                }
                else if (nextLength === 127) {
                    if (nextCursor + 8 > buffer.length)
                        break;
                    nextLength = Number(buffer.readBigUInt64BE(nextCursor));
                    nextCursor += 8;
                }
                if (nextCursor + nextLength > buffer.length)
                    break;
                combined = Buffer.concat([combined, buffer.subarray(nextCursor, nextCursor + nextLength)]);
                offset = nextCursor + nextLength;
                if ((nextFirst & 0x80) !== 0) {
                    frames[frames.length - 1] = { opcode: nextOpcode === OP_CONT ? opcode : nextOpcode, payload: combined };
                    break;
                }
            }
        }
    }
    return { frames, rest: buffer.subarray(offset) };
}
/** 自己实现握手 + 收发的最小 WebSocket 客户端 */
export class MiniWebSocket {
    options;
    socket;
    buffer = Buffer.alloc(0);
    handlers;
    closed = false;
    constructor(options, handlers) {
        this.options = options;
        this.handlers = handlers;
    }
    connect() {
        const parsed = new URL(this.options.url);
        const secure = parsed.protocol === 'wss:';
        const host = parsed.hostname;
        const port = parsed.port === '' ? (secure ? 443 : 80) : Number(parsed.port);
        const key = randomBytes(16).toString('base64');
        const lines = [
            'GET ' + (parsed.pathname + parsed.search) + ' HTTP/1.1',
            'Host: ' + host,
            'Upgrade: websocket',
            'Connection: Upgrade',
            'Sec-WebSocket-Key: ' + key,
            'Sec-WebSocket-Version: 13',
            ...Object.entries(this.options.headers ?? {}).map(([name, value]) => name + ': ' + value),
            '',
            '',
        ].join('\r\n');
        const onConnect = () => {
            // 拨号成功后再等握手响应；先发请求
            socket.write(lines);
        };
        let socket;
        let handshakeBuffer = Buffer.alloc(0);
        let handshaken = false;
        socket = secure
            ? tlsConnect({ host, port, servername: host }, () => onConnect())
            : netConnect({ host, port }, () => onConnect());
        this.socket = socket;
        const timeout = setTimeout(() => this.fail(new Error('WebSocket 握手超时')), this.options.timeoutMs ?? 15_000);
        timeout.unref?.();
        socket.on('data', (chunk) => {
            if (!handshaken) {
                handshakeBuffer = Buffer.concat([handshakeBuffer, chunk]);
                const end = handshakeBuffer.indexOf('\r\n\r\n');
                if (end < 0)
                    return;
                const head = handshakeBuffer.subarray(0, end).toString('utf8');
                const rest = handshakeBuffer.subarray(end + 4);
                clearTimeout(timeout);
                if (!/^HTTP\/1\.1 101/.test(head)) {
                    const logid = /x-tt-logid:\s*(\S+)/i.exec(head);
                    this.fail(new Error('WebSocket 握手失败：' + head.split('\r\n')[0] + (logid === null ? '' : '（logid ' + logid[1] + '）')));
                    return;
                }
                handshaken = true;
                this.handlers.onOpen?.();
                if (rest.length > 0)
                    this.consume(rest);
                return;
            }
            this.consume(chunk);
        });
        socket.on('error', (error) => this.fail(error));
        socket.on('close', () => {
            if (this.closed)
                return;
            this.closed = true;
            this.handlers.onClose?.(1006, '连接关闭');
        });
    }
    consume(chunk) {
        const { frames, rest } = decodeFrames(Buffer.concat([this.buffer, chunk]));
        this.buffer = rest;
        for (const frame of frames) {
            if (frame.opcode === OP_CLOSE) {
                const code = frame.payload.length >= 2 ? frame.payload.readUInt16BE(0) : 1005;
                const reason = frame.payload.subarray(2).toString('utf8');
                if (!this.closed) {
                    this.closed = true;
                    this.handlers.onClose?.(code, reason);
                }
                this.socket?.end();
                return;
            }
            if (frame.opcode === OP_PING) {
                this.socket?.write(encodeFrame(frame.payload, OP_PONG));
                continue;
            }
            if (frame.opcode === OP_TEXT || frame.opcode === OP_BINARY || frame.opcode === OP_CONT) {
                this.handlers.onMessage?.(frame.payload);
            }
        }
    }
    send(payload) {
        if (this.socket === undefined || this.closed)
            return;
        this.socket.write(encodeFrame(payload, OP_BINARY));
    }
    /** 发文本帧（Edge TTS 的控制帧是 JSON 文本） */
    sendText(text) {
        if (this.socket === undefined || this.closed)
            return;
        this.socket.write(encodeFrame(Buffer.from(text, 'utf8'), OP_TEXT));
    }
    close() {
        if (this.socket === undefined)
            return;
        if (!this.closed) {
            this.closed = true;
            try {
                this.socket.write(encodeFrame(Buffer.alloc(0), OP_CLOSE));
            }
            catch {
                // 忽略
            }
        }
        this.socket.end();
    }
    fail(error) {
        if (this.closed)
            return;
        this.closed = true;
        this.handlers.onError?.(error);
        this.socket?.destroy();
    }
}
