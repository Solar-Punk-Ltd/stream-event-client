import { Topic } from '@ethersphere/bee-js';
import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it, vi } from 'vitest';

import { FeedHealthTracker } from '../src/features/player/feedState.js';
import { LadderFeedPoller } from '../src/features/player/LadderFeedPoller.js';
import { ManifestStateManager } from '../src/features/player/ManifestManagement.js';
import type { PlayerReader } from '../src/features/player/playerReads.js';
import { type SwarmAnswer, UNSUPPORTED } from '../src/swarm/answers.js';
import type { SwarmProvider } from '../src/swarm/provider.js';
import { FreedomProvider } from '../src/swarm/providers/freedom/freedomProvider.js';
import type { FreedomSwarm } from '../src/swarm/providers/freedom/freedomSwarm.js';

import { VirtualTime } from './feedModel/virtualTime.js';
import { TimedGateway } from './helpers/timedGateway.js';

/**
 * An anonymous viewer of a ladder in Freedom: the site is not connected, so Freedom allows it 120 reads a minute, in a
 * fixed window that starts at the window's first read. The video reads its playlists through Freedom's node, and once
 * Freedom refuses a read for the budget the provider reads through the event gateway until the window is over, so the
 * player keeps following rather than waiting a minute.
 *
 * The poller follows the playing quality alone, about 36 reads a minute on this rig, which fits the budget by itself.
 * What spends it is the rest of the page reading through the same budget: here a browse page whose stream cards read
 * their previews just before the viewer opened the stream.
 */

const OWNER = 'ddeeff';
const GROUP = Topic.fromString('freedom-budget-group').toString();
const RUNGS = ['360p', '480p', '720p', '1080p'].map((name, at) => ({
  topic: Topic.fromString(`freedom-budget-${name}`),
  bandwidth: 700_000 * (at + 1),
}));
const PLAYING = RUNGS[3].topic;
/** Ant answered a slot it held in about 0.1 to 0.8 s, and one not written yet in 1.6 to 2.1 s. */
const HIT_MS = 650;
const MISS_MS = 2_000;
const ANONYMOUS_READS = 120;
const WINDOW_MS = 60_000;
const JOIN_AT_MS = 61_000;
const SEGMENT_MS = 2_000;

const state = ManifestStateManager.getInstance();
let pollers: { poller: LadderFeedPoller }[] = [];

const base64 = (bytes: Uint8Array) => Buffer.from(bytes).toString('base64');

const rejection = (code: number, message: string, data?: Record<string, unknown>) =>
  Object.assign(new Error(message), { code, ...(data && { data }) });

/**
 * Freedom's `window.swarm` over the rig's node, with Freedom's budget for an anonymous site counted against every read
 * on simulated time. The node answers as Ant does, through the rig's timings.
 */
function freedomOver(reader: PlayerReader, time: VirtualTime) {
  let windowStartedAtMs: number | null = null;
  let requests = 0;
  const counts = { served: 0, refused: 0 };
  const answered = (answer: SwarmAnswer, index: number | undefined, notThere: string) => {
    if (answer.kind === 'content') {
      counts.served += 1;
      return { data: base64(answer.bytes), encoding: 'base64', index: answer.feedIndex ?? index ?? 0 };
    }
    if (answer.kind === 'not-found') {
      counts.served += 1;
      throw rejection(-32602, notThere, { reason: notThere });
    }
    throw rejection(-32603, 'Request failed with status code 500');
  };
  const swarm: FreedomSwarm = {
    isFreedomBrowser: true,
    async request({ method, params = {} }) {
      const nowMs = time.trueNowMs;
      if (windowStartedAtMs === null || nowMs - windowStartedAtMs >= WINDOW_MS) {
        windowStartedAtMs = nowMs;
        requests = 0;
      }
      requests += 1;
      if (requests > ANONYMOUS_READS) {
        counts.refused += 1;
        throw rejection(-32602, 'Permission-free read budget exceeded', {
          reason: 'rate_limited',
          windowMs: WINDOW_MS,
          maxRequests: ANONYMOUS_READS,
        });
      }
      const owner = String(params.owner);
      if (method === 'swarm_readFeedEntry') {
        const topic = new Topic(String(params.topic));
        const index = params.index === undefined ? undefined : Number(params.index);
        const answer =
          index === undefined
            ? await reader.readFeedHead(owner, topic)
            : await reader.readFeedEntry(owner, topic, index);
        return answered(answer, index, index === undefined ? 'feed_empty' : 'entry_not_found');
      }
      if (method === 'swarm_readSingleOwnerChunk') {
        const answer = await reader.readSoc(owner, String(params.identifier));
        const result = answered(answer, undefined, 'chunk_not_found');
        return { ...result, span: Buffer.from(result.data, 'base64').length };
      }
      throw rejection(4200, `Unknown method: ${method}`);
    },
  };
  return { swarm, counts };
}

/** The event gateway, over the same rig, counting what it serves. */
function gatewayOver(reader: PlayerReader) {
  const counts = { served: 0 };
  const counted = async (answer: Promise<SwarmAnswer>) => {
    counts.served += 1;
    return answer;
  };
  const provider: SwarmProvider = {
    readFeedHead: (owner, topic, options) => counted(reader.readFeedHead(owner, topic, options)),
    readFeedEntry: (owner, topic, index, options) => counted(reader.readFeedEntry(owner, topic, index, options)),
    readSoc: (owner, identifier, options) => counted(reader.readSoc(owner, identifier, options)),
    readChunk: async () => UNSUPPORTED,
    readBytes: async () => UNSUPPORTED,
    urlFor: () => null,
    status: () => ({ state: 'ready' }),
    probe: async () => ({ kind: 'ok', elapsedMs: 0 }),
    start: async () => {},
    stop: async () => {},
  };
  return { provider, counts };
}

function makeRig() {
  const time = new VirtualTime();
  const node = new TimedGateway(time, OWNER, HIT_MS, MISS_MS);
  for (const [at, rung] of RUNGS.entries()) {
    node.addFeed(rung.topic, `rung-${at}`, { lagMs: 900 });
  }
  const freedom = freedomOver(node.reader, time);
  const gateway = gatewayOver(node.reader);
  const provider = new FreedomProvider({
    swarm: freedom.swarm,
    overBudget: gateway.provider,
    now: () => time.trueNowMs,
  });
  const health = new FeedHealthTracker(() => time.trueNowMs);
  const poller = new LadderFeedPoller(state, provider, 750, health, undefined, undefined, {
    now: () => time.trueNowMs,
    followClock: time.clock(),
    finder: node.knownHeadFinder(),
  });
  poller.register(OWNER, RUNGS, GROUP);
  pollers.push({ poller });
  return { time, node, freedom, gateway, poller };
}

/** The newest playlist the player holds of the playing quality, or -1 before it holds one. */
const heldIndex = () => Number(state.getIndex(PLAYING.toString())?.toBigInt() ?? -1n);

beforeEach(() => {
  state.clear();
  pollers = [];
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  vi.spyOn(console, 'debug').mockImplementation(() => undefined);
  vi.spyOn(console, 'info').mockImplementation(() => undefined);
});

afterEach(() => {
  for (const { poller } of pollers) {
    poller.unregister(RUNGS.map((rung) => rung.topic));
  }
  vi.restoreAllMocks();
});

describe("an anonymous viewer of a ladder in Freedom, over Freedom's read budget", () => {
  it('keeps following the playing quality through the event gateway while the budget is spent, then reads through Freedom again', async () => {
    const { time, node, freedom, gateway, poller } = makeRig();
    // The browse page's stream cards read their previews through the same budget, all but a few of its reads, in the
    // seconds before the viewer opened the stream.
    await time.runUntil(JOIN_AT_MS - 5_000);
    for (let card = 0; card < ANONYMOUS_READS - 4; card += 1) {
      freedom.swarm
        .request({ method: 'swarm_readFeedEntry', params: { owner: OWNER, topic: PLAYING.toHex(), index: card } })
        .catch(() => undefined);
    }
    await time.runUntil(JOIN_AT_MS);
    poller.activate(PLAYING.toString());

    // Every 2 s, as a segment is written, the player is at most two playlists behind the newest one written.
    let worstLag = 0;
    let gatewayServedWhileSpent = 0;
    for (let atMs = JOIN_AT_MS + 10_000; atMs <= JOIN_AT_MS + 240_000; atMs += SEGMENT_MS) {
      await time.runUntil(atMs);
      worstLag = Math.max(worstLag, node.newestAt(PLAYING, atMs) - heldIndex());
      if (atMs === JOIN_AT_MS + 40_000) {
        gatewayServedWhileSpent = gateway.counts.served;
      }
    }

    assert.ok(freedom.counts.refused > 0, 'Freedom never refused a read, so the budget was never spent');
    assert.ok(gatewayServedWhileSpent > 0, 'the gateway served nothing while the budget was spent');
    assert.ok(worstLag <= 2, `the player fell ${worstLag} playlists behind`);
    // Once Freedom's minute is over, the playlists are read through Freedom's node again.
    const servedByFreedomBefore = freedom.counts.served;
    await time.runUntil(JOIN_AT_MS + 300_000);
    assert.ok(freedom.counts.served > servedByFreedomBefore, 'Freedom was not read again after its minute');
    assert.ok(
      gateway.counts.served < freedom.counts.served,
      'the gateway served more than Freedom over the whole watch',
    );
  });
});
