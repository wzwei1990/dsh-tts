export interface WsFrame {
    opcode: number;
    payload: Buffer;
}
export interface WsHandlers {
    onOpen?: () => void;
    onMessage?: (payload: Buffer) => void;
    onClose?: (code: number, reason: string) => void;
    onError?: (error: Error) => void;
}
/** 把一段数据编成客户端帧（浏览器→服务端必须掩码） */
export declare function encodeFrame(payload: Buffer, opcode?: number): Buffer;
/** 从缓冲区里尽量多解析帧，返回帧数组与剩余字节 */
export declare function decodeFrames(buffer: Buffer): {
    frames: WsFrame[];
    rest: Buffer;
};
export interface WsConnectOptions {
    url: string;
    headers?: Record<string, string>;
    timeoutMs?: number;
}
/** 自己实现握手 + 收发的最小 WebSocket 客户端 */
export declare class MiniWebSocket {
    private readonly options;
    private socket;
    private buffer;
    private readonly handlers;
    private closed;
    constructor(options: WsConnectOptions, handlers: WsHandlers);
    connect(): void;
    private consume;
    send(payload: Buffer): void;
    close(): void;
    private fail;
}
