import type { Source } from '@/swarm/sources';

/** Where a message on the viewer's own stamp is sent, or that no source in their list can send one. */
export type OwnStampRoute =
  | { readonly ok: true; readonly through: 'bee-node'; readonly url: string }
  | { readonly ok: true; readonly through: 'weeb-3' }
  | { readonly ok: false };

const NO_ROUTE: OwnStampRoute = { ok: false };

type RouteSource = Pick<Source, 'id' | 'type' | 'url'>;

function routeThrough(source: RouteSource): OwnStampRoute {
  switch (source.type) {
    case 'bee-node':
      return { ok: true, through: 'bee-node', url: source.url.replace(/\/+$/, '') };
    case 'weeb-3':
      return { ok: true, through: 'weeb-3' };
    case 'gateway':
    // Sending a stamped chunk through the Freedom browser's node is not built yet.
    case 'freedom':
      return NO_ROUTE;
  }
}

/**
 * Only a Bee node of the viewer's own or the node in this browser sends a chunk under a stamp it is handed. The event
 * gateway's chat path stamps every write with the gateway's own batch, a `/bee` path on this site passes reads alone,
 * and the page cannot tell what any other gateway does with a stamp, so no gateway is ever sent one.
 *
 * The source picked for Chat history sends when it can. Otherwise the first Bee node in the list does, and then Weeb3.
 * The chat history is still read from its own source, and nothing here changes what the viewer picked.
 */
export function ownStampRoute(sources: readonly RouteSource[], chatSourceId: string): OwnStampRoute {
  const chatSource = sources.find(({ id }) => id === chatSourceId);
  const fallback =
    sources.find(({ type }) => type === 'bee-node') ?? sources.find(({ type }) => type === 'weeb-3') ?? null;
  for (const candidate of [chatSource, fallback]) {
    const route = candidate ? routeThrough(candidate) : NO_ROUTE;
    if (route.ok) {
      return route;
    }
  }
  return NO_ROUTE;
}
