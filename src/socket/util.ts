import { TimeoutError } from '../errors';
import { ISocketOptions } from '../interfaces';
import { ExponentialReconnectionPolicy } from './reconnection';

/**
 * Get the default options.
 */
export function getDefaults(): ISocketOptions {
    return {
        autoReconnect: true,
        callTimeout: 20 * 1000,
        reconnectionPolicy: new ExponentialReconnectionPolicy(),
        replyTimeout: 10000,
    };
}

export function timeout(delay: number) {
    return new Promise((resolve, reject) => setTimeout(() => reject(new TimeoutError()), delay));
}
