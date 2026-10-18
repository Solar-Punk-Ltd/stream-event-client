/**
 * Live mode's gate, in place of the local preflight: a run against a real deployment starts only when the viewer, its
 * config, the Swarm ID site and the gateway answer, the target stream is in the viewer's stream list, the chat answers,
 * and every address the run would use is one the target and the config name. It never refuses an address for not being
 * local, since nothing of a real deployment is.
 */
import { Bee, Topic } from '@ethersphere/bee-js';

import { viewerCatalogSchema } from '../../src/shared/catalog.ts';
import { isLocalDevHost } from './addresses.ts';
import type { PreflightCheck } from './preflight.ts';
import type { LiveDeployment } from './target.ts';

/** How long one read of the gate may take, so a deployment that hangs refuses the run rather than stalling it. */
const READ_TIMEOUT_MS = 30_000;

export interface LiveGateReadings {
  /** Every address the run would use, by name. */
  addresses: Record<string, string>;
  /** Every address the target and the config name, each as written there, resolved on the viewer's origin. */
  named: string[];
  /** The names of the addresses served from this machine on purpose, such as the hostile site's. */
  servedHere: string[];
  /** What the viewer's page and Swarm ID's site answered, null when nothing did. */
  viewer: number | null;
  swarmId: number | null;
  /** Why the viewer's config was refused, null when it was read and taken. */
  config: string | null;
  /** The stream list read through the gateway: its status, why it was refused, and how many streams it holds. */
  catalogue: { status: number | null; problem: string | null; streams: number };
  /** Whether the target stream is in that list, and its state there. */
  stream: { listed: boolean; state: string | null };
  /**
   * What the chat's read address answered for the first slot of the stream's chat feed, and whether the answer was
   * Bee's own, as JSON. A feed with no message yet answers Bee's 404, which still says the chat is there.
   */
  chat: { status: number | null; beeAnswer: boolean };
}

const normal = (address: string) => address.replace(/\/+$/, '');

/** Each address the run would use that the target and config do not name, or one served here that is not local. */
export function unnamedAddresses(
  addresses: Record<string, string>,
  named: readonly string[],
  servedHere: readonly string[],
): string[] {
  const known = new Set(named.map(normal));
  const out: string[] = [];
  for (const [name, address] of Object.entries(addresses)) {
    if (servedHere.includes(name)) {
      let local = false;
      try {
        local = isLocalDevHost(new URL(address).hostname);
      } catch {
        local = false;
      }
      if (!local) out.push(`${name}: ${address}, which is served from this machine`);
    } else if (!known.has(normal(address))) {
      out.push(`${name}: ${address}`);
    }
  }
  return out;
}

const answered = (status: number | null) => status ?? 'nothing';

/** Every check the live gate makes, in order. Any one that is not ok refuses the run. */
export function judgeLiveGate(readings: LiveGateReadings): PreflightCheck[] {
  const checks: PreflightCheck[] = [];
  const add = (name: string, ok: boolean, detail: string) => checks.push({ name, ok, detail });
  const unnamed = unnamedAddresses(readings.addresses, readings.named, readings.servedHere);
  add(
    'named addresses',
    unnamed.length === 0,
    unnamed.length
      ? `not named by the target or the config: ${unnamed.join(', ')}`
      : 'every address is named by the target or the config',
  );
  add('viewer', readings.viewer === 200, `answered ${answered(readings.viewer)}`);
  add('config', readings.config === null, readings.config ?? 'read and taken');
  add('swarm id', readings.swarmId === 200, `answered ${answered(readings.swarmId)}`);
  const { catalogue, stream, chat } = readings;
  add(
    'gateway',
    catalogue.status === 200 && catalogue.problem === null,
    catalogue.problem ?? `the stream list answered with ${catalogue.streams} streams`,
  );
  add(
    'stream',
    stream.listed,
    stream.listed ? `listed, ${stream.state ?? 'no state'}` : 'not in the stream list, so not published',
  );
  add(
    'chat',
    (chat.status === 200 || chat.status === 404) && chat.beeAnswer,
    `its feed's first slot answered ${answered(chat.status)}${chat.beeAnswer ? ', as Bee' : ', not as Bee'}`,
  );
  return checks;
}

async function statusOf(url: string): Promise<number | null> {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(READ_TIMEOUT_MS) });
    await response.arrayBuffer();
    return response.status;
  } catch {
    return null;
  }
}

/** The stream list through the gateway, as the viewer reads it, and whether the target stream is in it. */
async function readCatalogue(live: LiveDeployment): Promise<Pick<LiveGateReadings, 'catalogue' | 'stream'>> {
  const notListed = { listed: false, state: null };
  try {
    const reader = new Bee(live.gateway).feed.makeReader(Topic.fromString(live.catalog.topic), live.catalog.owner);
    const { payload } = await reader.downloadPayload();
    const parsed = viewerCatalogSchema.safeParse(JSON.parse(payload.toUtf8()));
    if (!parsed.success) {
      return {
        catalogue: { status: 200, problem: 'the stream list is not one the viewer reads', streams: 0 },
        stream: notListed,
      };
    }
    const { owner, topic, mediaType } = live.target.stream;
    const bare = (address: string) => address.toLowerCase().replace(/^0x/, '');
    const entry = parsed.data.find(
      (candidate) =>
        bare(candidate.owner) === bare(owner) && candidate.topic === topic && candidate.mediatype === mediaType,
    );
    return {
      catalogue: { status: 200, problem: null, streams: parsed.data.length },
      stream: entry ? { listed: true, state: entry.state ?? null } : notListed,
    };
  } catch (error) {
    const status = (error as { status?: number }).status ?? null;
    return {
      catalogue: { status, problem: `the stream list could not be read: ${String(error)}`, streams: 0 },
      stream: notListed,
    };
  }
}

/** The first slot of the stream's chat feed, through the chat's read address. */
async function readChat(live: LiveDeployment): Promise<LiveGateReadings['chat']> {
  const topic = Topic.fromString(live.deployment.chatTopic).toHex();
  const url = `${live.chatRead}/feeds/${live.deployment.feedOwner}/${topic}?index=0`;
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(READ_TIMEOUT_MS) });
    const body = await response.text();
    if (response.status === 200) return { status: 200, beeAnswer: true };
    let beeAnswer = false;
    try {
      beeAnswer = typeof (JSON.parse(body) as { code?: unknown }).code === 'number';
    } catch {
      beeAnswer = false;
    }
    return { status: response.status, beeAnswer };
  } catch {
    return { status: null, beeAnswer: false };
  }
}

/**
 * Every address the target and the config name, resolved as the run resolves them, what the target allows besides, and
 * the tunnels to the actors' own nodes.
 */
export function namedAddresses(live: LiveDeployment): string[] {
  return [
    live.viewer,
    live.gateway,
    live.chatRead,
    live.chatWrite,
    live.swarmId,
    live.ensRpc,
    ...live.target.alsoAllowed.map((allowed) => allowed.origin),
    ...Object.values(live.ownNodes),
  ];
}

/** Takes every reading the live gate judges, from the deployment itself. */
export async function readLiveGate(live: LiveDeployment): Promise<LiveGateReadings> {
  const [viewer, swarmId, listing, chat] = await Promise.all([
    statusOf(`${live.viewer}/`),
    statusOf(`${live.swarmId}/`),
    readCatalogue(live),
    readChat(live),
  ]);
  return {
    addresses: live.addresses.all(),
    named: namedAddresses(live),
    servedHere: ['evil'],
    viewer,
    swarmId,
    config: null,
    ...listing,
    chat,
  };
}
