/**
 * Which source each part of the viewer reads from: one source for all features, or a source per feature.
 * Pure, so the app keeps it in the browser and Connect shows it.
 */
import { SWARM_FEATURES, type SwarmFeature } from './client';

const ROUTING_MODES = ['one', 'per-part'] as const;

export type RoutingMode = (typeof ROUTING_MODES)[number];

/** The source id each part reads from. */
export type PartSources = Readonly<Record<SwarmFeature, string>>;

export interface Routing {
  readonly mode: RoutingMode;
  /** The source of every part, the chat history included, in {@link RoutingMode} `one`. */
  readonly source: string;
  /** Each part's own source in {@link RoutingMode} `per-part`. */
  readonly parts: PartSources;
}

function partsFrom(source: string): PartSources {
  return Object.fromEntries(SWARM_FEATURES.map((feature) => [feature, source])) as unknown as PartSources;
}

export function defaultRouting(defaultId: string): Routing {
  return { mode: 'one', source: defaultId, parts: partsFrom(defaultId) };
}

export function chooseSource(routing: Routing, id: string): Routing {
  return { ...routing, source: id };
}

/**
 * Per feature starts from the one source in use, so switching the mode changes nothing until a part is
 * picked. All features keeps the source it had.
 */
export function setMode(routing: Routing, mode: RoutingMode): Routing {
  if (mode === routing.mode) {
    return routing;
  }
  return mode === 'per-part' ? { ...routing, mode, parts: partsFrom(routing.source) } : { ...routing, mode };
}

export function setPart(routing: Routing, feature: SwarmFeature, id: string): Routing {
  return { ...routing, parts: { ...routing.parts, [feature]: id } };
}

/** The routing once a source is gone: whatever read from it reads from the default. */
export function withoutSource(routing: Routing, id: string, defaultId: string): Routing {
  const replaced = (current: string) => (current === id ? defaultId : current);
  return {
    ...routing,
    source: replaced(routing.source),
    parts: Object.fromEntries(
      SWARM_FEATURES.map((feature) => [feature, replaced(routing.parts[feature])]),
    ) as unknown as PartSources,
  };
}

/**
 * The source each part reads from now. A source no longer known reads from the default gateway, so a
 * removed source or a stale saved routing never leaves a part reading from nowhere. A source that serves
 * the video only, the node in this browser, is read for the video alone, picked per feature: any other part
 * a saved routing put on it, and every part when it was picked for all features, reads from the default.
 */
export function resolveRouting(
  routing: Routing,
  knownIds: readonly string[],
  defaultId: string,
  videoOnlyIds: readonly string[] = [],
): PartSources {
  const known = (id: string) => (knownIds.includes(id) ? id : defaultId);
  const notVideoOnly = (id: string) => (videoOnlyIds.includes(id) ? defaultId : known(id));
  if (routing.mode === 'one') {
    return partsFrom(notVideoOnly(routing.source));
  }
  return {
    player: known(routing.parts.player),
    'stream-list': notVideoOnly(routing.parts['stream-list']),
    previews: notVideoOnly(routing.parts.previews),
    chat: notVideoOnly(routing.parts.chat),
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
  const { mode, source, parts } = parsed as Record<string, unknown>;
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
  };
}
