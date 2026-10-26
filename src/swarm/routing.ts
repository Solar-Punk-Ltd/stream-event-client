/**
 * Which source each part of the viewer reads from: one source for all features, or a source per feature.
 * Pure, so the app keeps it in the browser and Connect shows it.
 */
import { SWARM_FEATURES, type SwarmFeature } from './client';
import type { Source, SourceType } from './sources';

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

/**
 * The parts a kind of source may be picked for. Weeb3 serves the video alone: its newest-entry search makes the
 * stream list, the previews and the chat history slow. A message on the viewer's own stamp can still be sent through
 * it, which Use for does not decide. The Freedom browser's node serves the video, the stream list and the previews,
 * and the chat history stays where it is read: polling a chat's slots would spend most of Freedom's read budget.
 */
const SERVED_PARTS: Readonly<Record<SourceType, readonly SwarmFeature[]>> = {
  gateway: SWARM_FEATURES,
  'bee-node': SWARM_FEATURES,
  'weeb-3': ['player'],
  freedom: ['player', 'stream-list', 'previews'],
};

export function servesPart(type: SourceType, feature: SwarmFeature): boolean {
  return SERVED_PARTS[type].includes(feature);
}

export function servesEveryPart(type: SourceType): boolean {
  return SWARM_FEATURES.every((feature) => servesPart(type, feature));
}

type RoutedSource = Pick<Source, 'id' | 'type'>;

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
 * The source each part reads from now. A source no longer known, or one that may not serve that part, reads from the
 * default gateway, so a removed source or a stale saved routing never leaves a part reading from nowhere. In
 * {@link RoutingMode} `one` a source that cannot serve every part is passed over whole.
 */
export function resolveRouting(routing: Routing, sources: readonly RoutedSource[], defaultId: string): PartSources {
  const typeOf = (id: string) => sources.find((source) => source.id === id)?.type;
  if (routing.mode === 'one') {
    const type = typeOf(routing.source);
    return partsFrom(type !== undefined && servesEveryPart(type) ? routing.source : defaultId);
  }
  const served = (feature: SwarmFeature) => {
    const id = routing.parts[feature];
    const type = typeOf(id);
    return type !== undefined && servesPart(type, feature) ? id : defaultId;
  };
  return {
    player: served('player'),
    'stream-list': served('stream-list'),
    previews: served('previews'),
    chat: served('chat'),
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
