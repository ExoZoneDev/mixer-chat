import { EventEmitter } from 'events';
import * as Socket from 'ws';

import { AuthenticationFailedError, MessageParserError, NoMethodFound, TimeoutError } from '../errors';
import { CallArgs, ICallOptions, ICloseEvent, ISpooledMethod } from '../interfaces';
import { IPacket, ISocketOptions, IUserAuth } from '../interfaces';
import { Reply } from './reply';
import { getDefaults, timeout } from './util';

const maxInt32 = 0xFFFFFFFF;

/**
 * SocketState is used to record the status of the websocket connection.
 */
export enum SocketState {
    /**
     * A connection attempt has not been made yet.
     */
    Idle = 1,
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
    protected options: ISocketOptions;
    protected state: SocketState;
    protected endpointOffset: number;
    protected queue: Map<string, ISpooledMethod> = new Map<string, ISpooledMethod>();
    protected replies: { [id: number]: Reply; } = {};
    protected authPacket: [number, number, string];
    protected reconnectTimeout: NodeJS.Timer;

    constructor(private endpoints: string[], options: ISocketOptions = {}) {
        super();
        this.setMaxListeners(Infinity);
        this.setOptions(options);
        this.endpointOffset = Math.floor(Math.random() * endpoints.length);

        this.on('message', (data: Socket.Data) => this.parsePacket(data));

        this.on('WelcomeEvent', () => {
            this.options.reconnectionPolicy.reset();
            if (this.state === SocketState.Reconnecting) {
                this.emit('reconnected');
            }
            this.state = SocketState.Connected;
            this.emit('ready'); // Emit a ready event for apps which want to know when the socket client is ready.
            this.unSpool(); // Un-spool any events queue to send to the server.
        });

        this.on('close', (evt: ICloseEvent) => {
            // TODO: Should the socket close out completely with certain codes?
            if (this.state === SocketState.Refreshing) {
                this.state = SocketState.Idle;
                this.boot();
                return;
            }

            if (this.state === SocketState.Closing) {
                this.state = SocketState.Closed;
                this.emit('closed');
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
    public setOptions(options: ISocketOptions) {
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
        if (this.state === SocketState.Closing) {
            this.state = SocketState.Refreshing;
            return this;
        }
        const wss = this.getAddress();

        this.socket = new Socket(wss);
        this.state = SocketState.Connecting;

        // Handle error events.
        this.socket.on('error', err => {
            if (this.state === SocketState.Closing) {
                return;
            }

            this.emit('error', err);
            this.socket.close();
        });

        // Handle the standard events.
        this.socket.addEventListener('open', () => this.emit('open'));
        this.socket.addEventListener('message', evt => this.emit('message', evt.data));
        this.socket.addEventListener('close', (evt: ICloseEvent) => this.emit('close', evt));

        return this;
    }

    /**
     * Should be called on reconnection. Authenticates and sends follow-up packets if we have any.
     */
    private unSpool() {
        // tslint:disable-next-line:no-var-self
        let self = this;

        /**
         * Method to send all the stored packets to the chat server.
         */
        function sendPackets() {
            self.queue.forEach((packet, key) => {
                self.send(packet.data, { force: true });
                packet.resolve();
                self.queue.delete(key);
            });

            self.state = SocketState.Connected;
            self.emit('connected');

            self = null;
        }

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
    public parsePacket(data: Socket.Data) {
        let packet: IPacket<any>;
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
    public send(data: any, options: ICallOptions = {}): Promise<any> {
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
    public auth(channelId: number, userId: number = null, authKey: string = null): Promise<IUserAuth> {
        this.authPacket = [channelId, userId, authKey];
        if (this.isConnected()) {
            return this.call('auth', this.authPacket);
        }

        return new Promise(resolve => this.once('authResult', resolve));
    }

    /**
     * Runs a method on the socket. Returns a promise that is rejected or resolved upon reply.
     */
    public call(method: string, args: CallArgs[] = [], options: ICallOptions = {}) {
        const id = Math.floor(Math.random() * maxInt32);
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
            clearTimeout(null);
            this.state = SocketState.Closed;
        }
    }
}
