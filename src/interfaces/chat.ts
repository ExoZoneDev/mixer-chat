export interface IPacket<T> {
    id: number;
    // tslint:disable-next-line:no-reserved-keywords
    type: 'reply' | 'event' | string;
    event: string;
    data: T;
}

export interface IUserAuth {
    authenticated: boolean;
    roles: string[];
}

export interface IBaseComponent {
    // tslint:disable-next-line:no-reserved-keywords
    type: 'text' | 'emoticon' | 'link'  | 'tag';
    text: string;
}

/**
 * Component is contained in a Message packet, used
 * to display a section of plain text.
 */
export interface ITextComponent extends IBaseComponent {
    // tslint:disable-next-line:no-reserved-keywords
    type: 'text';
    text: string;
}

export interface IEmoticonComponent extends IBaseComponent {
    // tslint:disable-next-line:no-reserved-keywords
    type: 'emoticon';
    pack: string;
    source: 'builtin' | 'subscriber';
    coords: {
        x: number;
        y: number;
        width: number;
        height: number;
    };
    alt: {
        [language: string]: string;
    };
}

export interface ILinkComponent extends IBaseComponent {
    // tslint:disable-next-line:no-reserved-keywords
    type: 'link';
    url: string;
}

export interface ITagComponent extends IBaseComponent {
    // tslint:disable-next-line:no-reserved-keywords
    type: 'tag';
    username: string;
    id: number;
}

export type IMessagePart = ITextComponent | IEmoticonComponent | ILinkComponent | ITagComponent;

export interface IMessagePacketComponents {
    meta: {
        whisper?: boolean;
        me?: boolean;
    };
    message: IMessagePart[];
}

export interface IChatMessage {
    id: string;
    channel: number;
    user_id: number;
    user_level: number;
    user_name: string;
    user_roles: string[];
    message: IMessagePacketComponents;
}

export interface IUserUpdate {
    user: number;
    username: string;
    roles: string[];
    permissions: string[];
}

export interface IPollEvent {
    /**
     * The question which was asked.
     */
    q: string;
    /**
     * The channelId which the event was sent from.
     */
    originatingChannel: number;
    /**
     * Array of the answers sorted by the index.
     */
    answers: string[];
    author: {
        user_name: string;
        user_id: number;
        user_roles: string[];
        user_level: number;
    };
    duration: number;
    endsAt: number;
    voters: number;
    responses: {
        [answer: string]: number;
    };
    responsesByIndex: number[];
}

export interface IUserConnection {
    id: number;
    username: string;
    roles: string[];
    /**
     * The channelId which the event was sent from.
     */
    originatingChannel: number;
}

export type IModerator = {
    user_id: number;
    user_name: string;
    user_roles: string[];
    user_level: number;
};

export interface IDeleteMessage {
    moderator: IModerator;
    id: string;
}

export interface IPurgeMessage {
    moderator: IModerator;
    user_id: number;
}

export interface IUserTimeout {
    user: {
        user_id: number;
        user_name: string;
        user_roles: string[];
        user_level: number;
    };
    duration: number;
}

export interface IClearMessages {
    clearer: IModerator;
}
