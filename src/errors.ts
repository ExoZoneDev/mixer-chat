export class MessageParserError extends Error {
    constructor(public readonly message: string) {
        super();
        if (Error.captureStackTrace) {
            Error.captureStackTrace(this, this.constructor);

            return;
        }
        // TODO: Stack frame?
    }
}

export class NoMethodFound extends Error {
    constructor(public readonly message: string) {
        super();
        if (Error.captureStackTrace) {
            Error.captureStackTrace(this, this.constructor);

            return;
        }
        // TODO: Stack frame?
    }
}

export class TimeoutError extends Error {
    constructor() {
        super();
        if (Error.captureStackTrace) {
            Error.captureStackTrace(this, this.constructor);

            return;
        }
        // TODO: Stack frame?
    }
}

export class AuthenticationFailedError extends Error {
    constructor(public readonly message: string) {
        super();
        if (Error.captureStackTrace) {
            Error.captureStackTrace(this, this.constructor);

            return;
        }
        // TODO: Stack frame?
    }
}
