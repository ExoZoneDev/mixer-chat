import { EventEmitter } from 'events';
import * as Socket from 'ws';

import { AuthenticationFailedError, MessageParserError, NoMethodFound, TimeoutError } from '../errors';
import * as Interfaces from '../interfaces';
import { Reply } from './reply';
import { getDefaults, timeout } from './util';

/**
 * SocketState is used to record the status of the websocket connection.
 */
export enum SocketState {
    /**
     * A connection attempt has not been made yet.
     */
    Idle,
    /**
     * A connection attempt is currently being made.
     */
    Connecting,
    /**
     * The socket is connected and data may be sent.
     */
    Connected,
    /**
     * The socket is gracefully closing; after this it will become Idle.
     */
    Closing,
    /**
     * The socket has been closed.
     */
    Closed,
    /**
     * The socket is reconnecting after closing.
     */
    Reconnecting,
    /**
     * Connect was called whilst the old socket was still open.
     */
    Refreshing,
}

export class ChatSocket extends EventEmitter {
    protected socket: Socket;
    protected options: Interfaces.ISocketOptions;
    protected state: SocketState = SocketState.Idle;
    protected endpointOffset: number;
    protected queue: Map<string, Interfaces.ISpooledMethod> = new Map<string, Interfaces.ISpooledMethod>();
    protected replies: { [id: number]: Reply; } = {};
    protected authPacket: [number, number, string];
    protected pingTimeoutHandle: NodeJS.Timer;
    protected reconnectTimeout: NodeJS.Timer;

    constructor(private endpoints: string[], options: Interfaces.ISocketOptions = {}) {
        super();
        this.setMaxListeners(Infinity);
        this.setOptions(options);
        this.endpointOffset = Math.floor(Math.random() * endpoints.length);

        this.on('close', (evt: Interfaces.ICloseEvent) => {
            // TODO: Should the socket close out completely with certain codes?
            if (this.state === SocketState.Refreshing) {
                this.state = SocketState.Idle;
                this.boot();
                return;
            }

            if (this.state === SocketState.Closing) {
                this.state = SocketState.Closed;
                this.emit('closed');
                clearTimeout(this.pingTimeoutHandle);
                clearTimeout(this.reconnectTimeout);
                return;
            }

            // If we are allowed to auto reconnect do so else just return out.
            if (!this.options.autoReconnect) {
                return;
            }

            this.state = SocketState.Reconnecting;
            const interval = this.options.reconnectionPolicy.next();
            this.emit('reconnecting', { interval, evt: evt });
            this.reconnectTimeout = setTimeout(() => this.boot(), interval);
        });
    }

    /**
     * Set the options.
     *
     * Defaults are applied at this stage.
     */
    public setOptions(options: Interfaces.ISocketOptions) {
        this.options = Object.assign({}, this.options || getDefaults(), options);
    }

    /**
     * Set the endpoints to be used for connections.
     */
    public setEndpoints(endpoints: string[]) {
        this.endpoints = endpoints;
        this.endpointOffset = Math.floor(Math.random() * endpoints.length);
    }

    /**
     * Returns the current socket state.
     */
    public getState(): SocketState {
        return this.state;
    }

    /**
     * Returns whether the socket is currently connected.
     */
    public isConnected(): boolean {
        return this.state === SocketState.Connected;
    }

    /**
     * Get a chat endpoint URI to be used for a connection.
     */
    public getAddress(): string {
        if (++this.endpointOffset >= this.endpoints.length) {
            this.endpointOffset = 0;
        }

        return this.endpoints[this.endpointOffset];
    }

    /**
     * Open a new socket connection to a chat server.
     */
    public boot() {
        const ws = this.socket = new Socket(this.getAddress());
        if (this.state === SocketState.Closing) {
            this.state = SocketState.Refreshing;
            return this;
        }
        const whilstSameSocket = (fn: (...args: any[]) => void) => {
            return (...args: any[]) => {
                if (this.socket === ws) {
                    fn.apply(this, args);
                }
            };
        };

        this.state = SocketState.Connecting;

        // WebSocket connection has opened without any errors.
        ws.on('open', whilstSameSocket(() => this.emit('open')));

        // WebSocket got a message frame so handle the packet.
        ws.on('message', whilstSameSocket((...args: any[]) => {
            this.resetPingTimeout();
            this.parsePacket.apply(this, args);
        }));

        // WebSocket got a close frame or we told it to close so handle that.
        ws.on('close', whilstSameSocket(evt => this.emit('close', evt)));

        // WebSocket threw an error so we should handle it.
        ws.on('error', whilstSameSocket(err => {
            if (this.state === SocketState.Closing) {
                return;
            }

            this.emit('error', err);
            ws.close();
        }));

        // Chat server has acknowledged our connection.
        this.once('WelcomeEvent', (data: Interfaces.IWelcomeEvent) => {
            this.options.reconnectionPolicy.reset();
            if (this.state === SocketState.Reconnecting) {
                this.emit('reconnected');
            }
            this.state = SocketState.Connected;
            this.resetPingTimeout();
            this.emit('ready', data); // Emit a ready event for apps which want to know when the socket client is ready.
            this.unSpool(); // Un-spool any events queue to send to the server.
        });

        return this;
    }

    /**
     * Start/Reset a ping timeout to send a ping frame to chat.
     */
    private resetPingTimeout() {
        clearTimeout(this.pingTimeoutHandle);

        this.pingTimeoutHandle = setTimeout(() => this.ping().catch(() => undefined), this.options.pingInterval);
    }

    /**
     * Send a ping frame to chat.
     */
    private async ping() {
        clearTimeout(this.pingTimeoutHandle);

        if (!this.isConnected()) {
            throw new TimeoutError();
        }

        const promise = Promise.race([
            timeout(this.options.pingTimeout),
            new Promise(resolve => this.socket.once('pong', resolve)),
        ]);

        // Ping the socket.
        this.socket.ping();

        return promise
            .then(this.resetPingTimeout.bind(this))
            .catch(err => {
                if (!(err instanceof TimeoutError)) {
                    throw err;
                }

                this.emit('error', err);
                this.socket.close();
            });
    }

    /**
     * Should be called on reconnection. Authenticates and sends follow-up packets if we have any.
     */
    private unSpool() {
        /**
         * Method to send all the stored packets to the chat server.
         */
        const sendPackets = () => {
            this.queue.forEach((packet, key) => {
                this.send(packet.data, { force: true })
                    .catch(err => this.emit('error', err));
                packet.resolve();
                this.queue.delete(key);
            });

            this.state = SocketState.Connected;
            this.emit('connected');
        };

        // If we have an auth packet try to auth with that packet again.
        if (this.authPacket) {
            this.call('auth', this.authPacket, { force: true })
                .then(res => this.emit('authResult', res))
                .then(sendPackets)
                .catch(() => {
                    this.emit('error', new AuthenticationFailedError('Failed to authenticate using saved auth packet.'));
                    this.close();
                });
        } else {
            sendPackets();
        }
    }

    /**
     * Parses an incoming packet from the websocket.
     */
    public parsePacket(data: string, flags?: { binary: boolean; }) {
        if (flags && flags.binary) {
            this.emit('error', new MessageParserError('Somehow got a binary packet?'));

            return;
        }
        let packet: Interfaces.IPacket<any>;
        try {
            packet = JSON.parse(<string>data);
        } catch (err) {
            this.emit('error', new MessageParserError('Unable to parse the packet as JSON.'));

            return;
        }

        this.emit('debug', '<<', packet); // Emit all packets for debug purposes.

        switch (packet.type) {
            case 'reply':
                const reply = this.replies[packet.id];
                if (reply != null) {
                    reply.handle(packet);
                    delete this.replies[packet.id];
                } else {
                    this.emit('error', new NoMethodFound('No handler for reply Id.'));
                }
                break;
            case 'event':
                this.emit(packet.event, packet.data);
                break;
            default:
                this.emit('error', new MessageParserError(`Unknown packet found ${packet.type}`));
                return;
        }
    }

    /**
     * Sends raw packet data to the server. It may not send immediately; if we aren't connected, it'll just be spooled up.
     */
    public send(data: any, options: Interfaces.ICallOptions = {}): Promise<any> {
        if (this.isConnected() || options.force) {
            this.socket.send(JSON.stringify(data));
            this.emit('debug', '>>', data);
            return Promise.resolve();
        } else if (data.method !== 'auth') {
            return new Promise(resolve => {
                this.queue.set(data.method, { resolve, data });
                this.emit('spooled', data);
            });
        }

        return Promise.resolve();
    }

    /**
     * Auth sends a packet over the socket to authenticate with a chat server and join a specified channel.
     *
     * If you wish to join anonymously, userId and authKey can be omitted.
     */
    public auth(channelId: number, userId: number = null, authKey: string = null): Promise<Interfaces.IUserAuth> {
        this.authPacket = [channelId, userId, authKey];
        if (this.isConnected()) {
            return this.call('auth', this.authPacket);
        }

        return new Promise(resolve => this.once('authResult', resolve));
    }

    /**
     * Runs a method on the socket. Returns a promise that is rejected or resolved upon reply.
     */
    public call(method: string, args: Interfaces.CallArgs[] = [], options: Interfaces.ICallOptions = {}) {
        const id = Math.floor(Math.random() * Number.MAX_SAFE_INTEGER);
        const replyPromise = new Promise((resolve, reject) => this.replies[id] = new Reply(resolve, reject));

        return this.send({ type: 'method', method, arguments: args, id }, options)
            .then(() => {
                if (options.noReply) {
                    return Promise.resolve();
                }

                return Promise.race<any>([
                    timeout(options.timeout || this.options.callTimeout),
                    replyPromise,
                ]);
            })
            .catch(err => {
                if (err instanceof TimeoutError) {
                    delete this.replies[id];
                }
                throw err;
            });
    }

    /**
     * Closes the websocket.
     */
    public close() {
        if (this.socket) {
            this.socket.close();
            this.state = SocketState.Closing;
        } else {
            clearTimeout(this.reconnectTimeout);
            clearTimeout(this.pingTimeoutHandle);
            this.state = SocketState.Closed;
        }
    }
}
