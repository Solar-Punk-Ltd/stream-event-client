import { describe, expect, it } from 'vitest';

import { NODE_NOT_READY } from '../../src/features/gateway/checkSentences';
import { describeNodeState, inspectBeeNode, MINIMUM_BEE_VERSION } from '../../src/features/gateway/nodeReadiness';

type Answers = Partial<Record<'health' | 'readiness' | 'peers', Response | Error>>;

/** A node answering each of the three paths as told, a 404 for anything it was not told about. */
function node(answers: Answers) {
  const asked: string[] = [];
  const fetcher = (async (input: RequestInfo | URL) => {
    const url = String(input);
    asked.push(url);
    const path = url.slice(url.lastIndexOf('/') + 1) as keyof Answers;
    const answer = answers[path];
    if (answer instanceof Error) {
      throw answer;
    }
    return answer?.clone() ?? new Response('', { status: 404 });
  }) as typeof fetch;
  return { asked, inspect: () => inspectBeeNode('http://localhost:1633', { fetcher }) };
}

const health = (version: string) => Response.json({ status: 'ok', version, apiVersion: '7.3.0' });
const READY = Response.json({ status: 'ready', version: '2.8.2', apiVersion: '7.3.0' });
const NOT_READY = Response.json({ status: 'notReady', version: '2.8.2', apiVersion: '7.3.0' }, { status: 400 });
const PEERS = Response.json({ peers: [{ address: 'ab'.repeat(32), fullNode: true }] });

describe("what a Bee node's health, readiness and peers say before a viewer switches to it", () => {
  it('asks the three paths under the address', async () => {
    const { asked, inspect } = node({ health: health('2.8.2'), readiness: READY, peers: PEERS });

    expect(await inspect()).toEqual({ kind: 'ready' });
    expect(asked.toSorted()).toEqual([
      'http://localhost:1633/health',
      'http://localhost:1633/peers',
      'http://localhost:1633/readiness',
    ]);
  });

  it('finds a node still starting by its readiness, which Bee answers 400 until every part is up', async () => {
    expect(await node({ health: health('2.8.2'), readiness: NOT_READY, peers: PEERS }).inspect()).toEqual({
      kind: 'starting',
    });
  });

  it('finds a node still starting by its peers, which Bee answers 503 until its full API is on', async () => {
    const peers = Response.json({ code: 503, message: 'Node is syncing.' }, { status: 503 });
    expect(await node({ health: health('2.8.2'), readiness: READY, peers }).inspect()).toEqual({ kind: 'starting' });
  });

  it('finds a node with no peers, which cannot fetch anything from Swarm', async () => {
    const peers = Response.json({ peers: [] });
    expect(await node({ health: health('2.8.2'), readiness: READY, peers }).inspect()).toEqual({ kind: 'no-peers' });
  });

  it.each(['2.2.0', '2.2.9-a1b2c3d4', '1.18.2'])('finds version %s older than the viewer needs', async (version) => {
    expect(await node({ health: health(version), readiness: READY, peers: PEERS }).inspect()).toEqual({
      kind: 'too-old',
      version,
    });
  });

  it.each(['2.3.0', '2.8.2-rc1-0a1b2c3d', '3.0.0'])('takes version %s', async (version) => {
    expect(await node({ health: health(version), readiness: READY, peers: PEERS }).inspect()).toEqual({
      kind: 'ready',
    });
  });

  it('takes a node it cannot read more of as ready, so a proxy that serves health alone is not turned away', async () => {
    expect(await node({ health: Response.json({ status: 'ok' }) }).inspect()).toEqual({ kind: 'ready' });
    expect(
      await node({ health: health('not a version'), readiness: new TypeError('Failed to fetch') }).inspect(),
    ).toEqual({ kind: 'ready' });
    expect(
      await node({ health: health('2.8.2'), readiness: READY, peers: new Response('{', { status: 200 }) }).inspect(),
    ).toEqual({ kind: 'ready' });
  });

  it('holds the floor at the release that added GET /soc, which feed entries, markers and the chat read', () => {
    expect(MINIMUM_BEE_VERSION).toBe('2.3.0');
  });
});

describe('the sentence for a node that is there and not ready', () => {
  it.each([
    [{ kind: 'starting' } as const, NODE_NOT_READY.starting],
    [{ kind: 'no-peers' } as const, NODE_NOT_READY.noPeers],
  ])('%o', (state, sentence) => {
    expect(describeNodeState(state)).toBe(sentence);
  });

  it('names the version found and the one needed', () => {
    expect(describeNodeState({ kind: 'too-old', version: '2.2.0' })).toBe(NODE_NOT_READY.tooOld('2.2.0', '2.3.0'));
    expect(NODE_NOT_READY.tooOld('2.2.0', '2.3.0')).toBe(
      'This Bee node runs version 2.2.0, and this viewer needs 2.3.0 or newer. Update the node, then try again.',
    );
  });

  it('says to wait while it starts, and why a node with no peers cannot be used yet', () => {
    expect(NODE_NOT_READY.starting).toBe(
      'The Bee node at this address is still starting. Wait a minute, then try again.',
    );
    expect(NODE_NOT_READY.noPeers).toBe(
      'The Bee node at this address is running but has no peers yet, so it cannot fetch anything from Swarm. Wait a minute for it to connect, then try again.',
    );
  });
});
