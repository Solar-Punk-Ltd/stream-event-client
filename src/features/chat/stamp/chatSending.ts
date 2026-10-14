import { MessageVia } from '@solarpunkltd/swarm-chat-js/message';

/**
 * How the viewer's chat messages go out: through the event's chat write address, which stamps them, or on the
 * viewer's own stamp, with or without a copy in their own feed. On their stamp a message goes to their own Bee node
 * at `url`, or, with `url` null, through the node in this browser when the chat reads from it, which the chat asks at
 * every write. With neither it is held.
 */
export type ChatSending =
  | { readonly via: typeof MessageVia.GATEWAY }
  | { readonly via: typeof MessageVia.OWN_STAMP; readonly url: string | null; readonly ownFeed: boolean };

export const GATEWAY_SENDING: ChatSending = { via: MessageVia.GATEWAY };
