import { IReconnectionPolicy } from '../socket/reconnection';

export * from './chat';

export type CallArgs = string | number | string[];

export interface ICallOptions {
    noReply?: boolean;
    timeout?: number;
    force?: boolean;
}

export interface ISpooledMethod {
    data: any;
    resolve: any;
}

export interface ICloseEvent {
    code: number;
    reason: string;
    wasClean: boolean;
}

export interface IErrorEvent {
    code: number;
    errno: string;
    address: string;
    port: number;
    // tslint:disable-next-line:no-reserved-keywords
    type: string;
}

/**
 * SocketOptions are passed to the Chat Socket.
 */
export interface ISocketOptions {
    // Reconnection policy handler.
    reconnectionPolicy?: IReconnectionPolicy;
    // Should the module auto reconnect to a chat socket.
    autoReconnect?: boolean;
    // Timeout on Chat method calls before we throw an error.
    replyTimeout?: number;
    // Number of milliseconds to wait in .call() before we give up waiting
    callTimeout?: number;
}
