/**
 * Simple wrapper that waits for a dispatches a method reply.
 */
export class Reply {
    constructor(private resolve: any, private reject: any) {}

    /**
     * Handles "reply" packet data from the websocket.
     */
    public handle(packet: any) {
        if (packet.error) {
            this.reject(packet.error);
        } else {
            this.resolve(packet.data);
        }
    }
}
