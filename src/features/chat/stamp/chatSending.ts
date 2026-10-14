import { MessageVia } from '@solarpunkltd/swarm-chat-js/message';

/**
 * How the viewer's chat messages go out: through the event's chat write address, which stamps them, or on the
 * viewer's own stamp through their own Bee node at `url`, null while the chat's source is no Bee node, with or without a copy in their own feed. Weeb3 joins as a
 * third way once it can send.
 */
export type ChatSending =
  | { readonly via: typeof MessageVia.GATEWAY }
  | { readonly via: typeof MessageVia.OWN_STAMP; readonly url: string | null; readonly ownFeed: boolean };

export const GATEWAY_SENDING: ChatSending = { via: MessageVia.GATEWAY };
