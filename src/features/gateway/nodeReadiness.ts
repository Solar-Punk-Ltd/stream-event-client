/**
 * Whether a Bee node that answers its health can serve this viewer yet: started, connected to peers,
 * and new enough. Asked before the picker switches to it, because a node that fails any of these shows
 * a viewer an empty stream list with nothing to say why.
 *
 * Anything this cannot read, a path a proxy does not serve, a refused request, a body that is not Bee's,
 * is taken as no objection. The health check has already shown a Bee node is there, and turning a
 * working node away on a guess is worse than letting the viewer try it.
 */
import { boundedRequest } from '@/swarm/boundedRequest';
import { PROBE_TIMEOUT_MS } from '@/swarm/provider';

import { NODE_NOT_READY } from './checkSentences';

/**
 * The oldest Bee release this viewer works with. 2.3.0 added `GET /soc/{owner}/{id}`, which the viewer
 * reads every feed entry by index through, the player's time markers and the chat's slots included.
 * Every other path it reads (`/feeds`, `/chunks`, `/bytes`, `/bzz`) is older.
 */
export const MINIMUM_BEE_VERSION = '2.3.0';

export type NodeState =
  | { readonly kind: 'ready' }
  /** Bee answers `/readiness` 400, or its full API 503, until every part of it is up. */
  | { readonly kind: 'starting' }
  | { readonly kind: 'no-peers' }
  | { readonly kind: 'too-old'; readonly version: string };

export interface InspectOptions {
  /** Injected by tests. The global `fetch` otherwise. */
  readonly fetcher?: typeof fetch;
  readonly signal?: AbortSignal;
  readonly timeoutMs?: number;
}

const READY: NodeState = { kind: 'ready' };
const BAD_REQUEST = 400;
const SERVICE_UNAVAILABLE = 503;

type Version = readonly [number, number, number];

/** The release a Bee version string names, such as `2.8.2-rc1-0a1b2c3d`, or null when it names none. */
function releaseOf(version: string): Version | null {
  const match = /^v?(\d+)\.(\d+)\.(\d+)/.exec(version.trim());
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : null;
}

function isOlder(version: Version, than: Version): boolean {
  for (let at = 0; at < version.length; at += 1) {
    if (version[at] !== than[at]) {
      return version[at] < than[at];
    }
  }
  return false;
}

const MINIMUM_RELEASE = releaseOf(MINIMUM_BEE_VERSION) as Version;

/** A JSON body, or null for anything that is not one. */
function jsonOf(body: Uint8Array | null): unknown {
  if (body === null) {
    return null;
  }
  try {
    return JSON.parse(new TextDecoder().decode(body)) as unknown;
  } catch {
    return null;
  }
}

function versionOf(health: unknown): string | null {
  const version = (health as { version?: unknown } | null)?.version;
  return typeof version === 'string' ? version : null;
}

function peerCountOf(peers: unknown): number | null {
  const list = (peers as { peers?: unknown } | null)?.peers;
  return Array.isArray(list) ? list.length : null;
}

/** Asks `/health`, `/readiness` and `/peers` together. Never rejects. */
export async function inspectBeeNode(baseUrl: string, options: InspectOptions = {}): Promise<NodeState> {
  const { fetcher = fetch, signal, timeoutMs = PROBE_TIMEOUT_MS } = options;
  const ask = (path: string) =>
    boundedRequest(`${baseUrl}/${path}`, { fetcher, timeoutMs, signal, readsBody: () => true });
  const [health, readiness, peers] = await Promise.all([ask('health'), ask('readiness'), ask('peers')]);

  const version = health.kind === 'response' ? versionOf(jsonOf(health.body)) : null;
  const release = version === null ? null : releaseOf(version);
  if (version !== null && release !== null && isOlder(release, MINIMUM_RELEASE)) {
    return { kind: 'too-old', version };
  }
  if (readiness.kind === 'response' && readiness.response.status === BAD_REQUEST) {
    return { kind: 'starting' };
  }
  if (peers.kind !== 'response') {
    return READY;
  }
  if (peers.response.status === SERVICE_UNAVAILABLE) {
    return { kind: 'starting' };
  }
  return peers.response.ok && peerCountOf(jsonOf(peers.body)) === 0 ? { kind: 'no-peers' } : READY;
}

/** What the picker tells a viewer about a node that is there and cannot serve them yet. */
export function describeNodeState(state: Exclude<NodeState, { kind: 'ready' }>): string {
  switch (state.kind) {
    case 'starting':
      return NODE_NOT_READY.starting;
    case 'no-peers':
      return NODE_NOT_READY.noPeers;
    case 'too-old':
      return NODE_NOT_READY.tooOld(state.version, MINIMUM_BEE_VERSION);
  }
}
