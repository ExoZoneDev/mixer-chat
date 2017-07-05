# Mixer Chat

This is a new module which allows you to connect to Mixer Chat Servers.

Some of the code is based of the original chat code from [beam-client-node](https://github.com/mixer/beam-client-node/blob/master/lib/ws/ws.js) which did it's job
but being stuck with the bulky module and bugs. It was easier to create this to just handle chat connections and have better error handling/methods.
We plan on expanding this to contain more features and better hooks for developers to use. But for now it's the basic module to connect to chat and stay connected
with built in reconnection logic.

There are an array of options you can change with the socket connection. Of which are all typed so please explore the code or mess around
in TypeScript to see what's on offer.

## To Do
- Built in channel manager. (To enable users to just request a new channel and the module will connect/manage and send up events)
- Verbose error handling (Enable more error handling from both Mixer and CloudFlare to enable better reconnecting)
- In build endpoint handling. (To allow the module to auto refresh the endpoints/authkey for chat connections)

## Setup
- Install the module using `npm i mixer-chat --save`

## Usage
This is a simple usage to connect to a channel chat.

```typescript
import { ChatSocket, IChatMessage, IUserUpdate } from 'mixer-chat';

/**
 * You will need the channelId of the channel you wish to connect too; and the userId of the user you want to
 * connect to chat as. You can find information about how to do this here: https://dev.mixer.com/reference/chat/index.html#chat__introduction
 **/

async function connect(channelId: number, userId: number, authKey: string) {
    // Create the chat socket.
    const endpoints: string[] = []; // List of endpoints taken from the `chats/:id` endpoint.
    const chat = new ChatSocket(endpoints).boot();

    // Authenticate to the server
    const isAuthed = await chat.auth(channelId, userId, authKey); // Returns the userRoles and if authenticated.

    // You'll now get events from the server on new messages/events etc...
    chat.on('ChatMessage', (message: IChatMessage) => {
        console.log(message);
    });
    chat.on('UserUpdate', (update: IUserUpdate) => {
        console.log(update);
    });
    // Etc...
}

// Connect to a channel chat.
connect(1, 2, 'jnoh986');
```
