/**
 * Which source each part of the viewer reads from: one source for everything, or a source per part.
 * Pure, so the app keeps it in the browser and the Sources screen shows it.
 *
 * The video and the stream list are linked by default, because the player finds a live stream's
 * newest entry from time markers at addresses computed from the clock of whoever serves the stream
 * list, so the two reading from different hosts can put the player behind or ahead of live.
 */
import { SWARM_FEATURES, type SwarmFeature } from './client';
import { CHAT_READ_GATEWAY_ID } from './settings';

export const ROUTING_MODES = ['one', 'per-part'] as const;

export type RoutingMode = (typeof ROUTING_MODES)[number];

/**
 * What the chat reads from unless a viewer picks another source for it: the event's chat read address,
 * where the chat server writes its feed. The gateways the deployment offers refuse the chat's paths.
 */
export const CHAT_SERVICE_ID = CHAT_READ_GATEWAY_ID;

/** The parts that move together while linked. */
const LINKED_PARTS: readonly SwarmFeature[] = ['player', 'stream-list'];

/** The source id each part reads from. */
export type PartSources = Readonly<Record<SwarmFeature, string>>;

export interface Routing {
  readonly mode: RoutingMode;
  /** The source of every part but the chat in {@link RoutingMode} `one`. */
  readonly source: string;
  /** Each part's own source in {@link RoutingMode} `per-part`. */
  readonly parts: PartSources;
  /** Whether the stream list reads from wherever the video does. */
  readonly linked: boolean;
}

const READ_FROM_ONE_SOURCE: readonly SwarmFeature[] = SWARM_FEATURES.filter((feature) => feature !== 'chat');

function partsFrom(source: string, chat: string): PartSources {
  return Object.fromEntries([
    ...READ_FROM_ONE_SOURCE.map((feature) => [feature, source]),
    ['chat', chat],
  ]) as unknown as PartSources;
}

export function defaultRouting(defaultId: string): Routing {
  return { mode: 'one', source: defaultId, parts: partsFrom(defaultId, CHAT_SERVICE_ID), linked: true };
}

export function chooseSource(routing: Routing, id: string): Routing {
  return { ...routing, source: id };
}

/**
 * Per part starts from the one source in use, so switching the mode changes nothing until a part is
 * picked. One source keeps the source it had.
 */
export function setMode(routing: Routing, mode: RoutingMode): Routing {
  if (mode === routing.mode) {
    return routing;
  }
  return mode === 'per-part'
    ? { ...routing, mode, parts: partsFrom(routing.source, routing.parts.chat) }
    : { ...routing, mode };
}

export function setPart(routing: Routing, feature: SwarmFeature, id: string): Routing {
  const moved = routing.linked && LINKED_PARTS.includes(feature) ? LINKED_PARTS : [feature];
  return { ...routing, parts: { ...routing.parts, ...Object.fromEntries(moved.map((part) => [part, id])) } };
}

/** Linking again moves the stream list to the video's source. */
export function setLinked(routing: Routing, linked: boolean): Routing {
  return {
    ...routing,
    linked,
    parts: linked ? { ...routing.parts, 'stream-list': routing.parts.player } : routing.parts,
  };
}

/** The routing once a source is gone: whatever read from it reads from the default, the chat from its service. */
export function withoutSource(routing: Routing, id: string, defaultId: string): Routing {
  const replaced = (feature: SwarmFeature, current: string) =>
    current !== id ? current : feature === 'chat' ? CHAT_SERVICE_ID : defaultId;
  return {
    ...routing,
    source: routing.source === id ? defaultId : routing.source,
    parts: Object.fromEntries(
      SWARM_FEATURES.map((feature) => [feature, replaced(feature, routing.parts[feature])]),
    ) as unknown as PartSources,
  };
}

/**
 * The source each part reads from now. A source no longer known reads from the default gateway, or
 * for the chat from its service, so a removed source or a stale saved routing never leaves a part
 * reading from nowhere. A source that serves the video only, the node in this browser, is read for the
 * video alone, picked per part: any other part a saved routing put on it, and every part when it was
 * picked as the one source, reads from where it would have read without it.
 */
export function resolveRouting(
  routing: Routing,
  knownIds: readonly string[],
  defaultId: string,
  videoOnlyIds: readonly string[] = [],
): PartSources {
  const known = (id: string, otherwise: string) => (knownIds.includes(id) ? id : otherwise);
  const notVideoOnly = (id: string, otherwise: string) =>
    videoOnlyIds.includes(id) ? otherwise : known(id, otherwise);
  if (routing.mode === 'one') {
    return partsFrom(notVideoOnly(routing.source, defaultId), CHAT_SERVICE_ID);
  }
  const player = known(routing.parts.player, defaultId);
  return {
    player,
    'stream-list': notVideoOnly(routing.linked ? player : routing.parts['stream-list'], defaultId),
    previews: notVideoOnly(routing.parts.previews, defaultId),
    chat: routing.parts.chat === CHAT_SERVICE_ID ? CHAT_SERVICE_ID : notVideoOnly(routing.parts.chat, CHAT_SERVICE_ID),
  };
}

export function serializeRouting(routing: Routing): string {
  return JSON.stringify(routing);
}

const isText = (value: unknown): value is string => typeof value === 'string' && value !== '';

/**
 * The routing a browser kept, as {@link serializeRouting} wrote it. Anything unreadable is the default,
 * and a part it cannot read keeps the default's source for that part.
 */
export function parseRouting(saved: string | null, fallback: Routing): Routing {
  if (saved === null) {
    return fallback;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(saved);
  } catch {
    return fallback;
  }
  if (typeof parsed !== 'object' || parsed === null) {
    return fallback;
  }
  const { mode, source, parts, linked } = parsed as Record<string, unknown>;
  if (!ROUTING_MODES.includes(mode as RoutingMode) || !isText(source)) {
    return fallback;
  }
  const savedParts = typeof parts === 'object' && parts !== null ? (parts as Record<string, unknown>) : {};
  return {
    mode: mode as RoutingMode,
    source,
    parts: Object.fromEntries(
      SWARM_FEATURES.map((feature) => {
        const part = savedParts[feature];
        return [feature, isText(part) ? part : fallback.parts[feature]];
      }),
    ) as unknown as PartSources,
    linked: typeof linked === 'boolean' ? linked : fallback.linked,
  };
}
