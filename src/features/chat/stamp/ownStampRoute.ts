import type { Source } from '@/swarm/sources';

export const EVENT_GATEWAY_STAMPS_ITSELF =
  'The event gateway stamps every chat message with its own stamp, so it cannot send one on yours.';
export const GATEWAY_STAMPS_ITSELF =
  'A gateway stamps chat messages with its own stamp or takes none, so it cannot send one on yours.';
export const WEEB3_SENDS_LATER = 'Weeb3 cannot send chat messages yet.';
export const PICK_A_BEE_NODE = 'Pick your Bee node for Chat history in Use for.';

/** Where a message on the viewer's own stamp is sent, or why the chat's source cannot send one. */
export type OwnStampRoute =
  | { readonly ok: true; readonly url: string }
  | { readonly ok: false; readonly reason: string; readonly hint: string };

/**
 * A message on the viewer's own stamp goes out through the source picked for the chat, and only a Bee node stores a
 * chunk under a stamp it is handed. The event gateway's chat path stamps every write with the gateway's own batch, a
 * `/bee` path on this site passes reads alone, and the page cannot tell what any other gateway does with a stamp, so
 * none of them is sent one. Nothing is sent through another source in their place.
 */
export function ownStampRoute(
  source: Pick<Source, 'id' | 'type' | 'url' | 'offered'>,
  defaultId: string,
): OwnStampRoute {
  switch (source.type) {
    case 'bee-node':
      return { ok: true, url: source.url.replace(/\/+$/, '') };
    case 'gateway':
      return {
        ok: false,
        reason: source.offered && source.id === defaultId ? EVENT_GATEWAY_STAMPS_ITSELF : GATEWAY_STAMPS_ITSELF,
        hint: PICK_A_BEE_NODE,
      };
    case 'weeb-3':
      return { ok: false, reason: WEEB3_SENDS_LATER, hint: PICK_A_BEE_NODE };
  }
}
