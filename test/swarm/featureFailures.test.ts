import { Topic } from '@ethersphere/bee-js';
import { describe, expect, it } from 'vitest';

import { SwarmClient } from '../../src/swarm/client';
import { FAILING_AFTER_MS, QUIET_AFTER_MS } from '../../src/swarm/featureFailures';
import { content, fault, notFound, ScriptedProvider } from '../helpers/scriptedProvider';

const REFERENCE = 'ef'.repeat(32);
const TOPIC = Topic.fromString('failures-test');
const timeout = { kind: 'unavailable' as const, cause: { kind: 'timeout' as const, timeoutMs: 10_000 } };

function world() {
  const event = new ScriptedProvider('event');
  const chat = new ScriptedProvider('chat');
  let nowMs = 1_000_000;
  const client = new SwarmClient({
    chosen: { id: 'event', provider: event },
    routes: { chat: { id: 'chat-source', provider: chat } },
    now: () => nowMs,
  });
  return { event, chat, client, advance: (ms: number) => void (nowMs += ms) };
}

describe('which parts fail on the source they read from', () => {
  it('names none while every read is answered', async () => {
    const { client } = world();
    await client.reader('player').readBytes(REFERENCE);

    expect(client.failures()).toEqual([]);
  });

  it("names a part once its reads have had no answer for the bar's wait, with how long and its source", async () => {
    const { event, client, advance } = world();
    event.answer = timeout;
    event.onAsk = () => advance(FAILING_AFTER_MS - 2_000);
    await client.reader('player').readBytes(REFERENCE);
    expect(client.failures(), 'one slow read is not a failure').toEqual([]);

    await client.reader('player').readBytes(REFERENCE);

    expect(client.failures()).toEqual([
      { feature: 'player', provider: 'event', forMs: 2 * (FAILING_AFTER_MS - 2_000), cause: { kind: 'no-answer' } },
    ]);
  });

  it('says what the last failing read ended in', async () => {
    const { event, client, advance } = world();
    event.answer = { kind: 'unavailable', cause: { kind: 'status', status: 503 } };
    await client.reader('stream-list').readBytes(REFERENCE);
    advance(FAILING_AFTER_MS);
    event.answer = { kind: 'rate-limited', retryAfterMs: null, serverTimeMs: null };
    await client.reader('stream-list').readBytes(REFERENCE);
    expect(client.failures()[0]).toMatchObject({ feature: 'stream-list', cause: { kind: 'rate-limited' } });

    event.answer = { kind: 'unavailable', cause: { kind: 'status', status: 503 } };
    await client.reader('stream-list').readBytes(REFERENCE);
    expect(client.failures()[0].cause).toEqual({ kind: 'status', status: 503 });
  });

  it('clears a part at its first answer, a not found included, since that is an answer about the content', async () => {
    const { event, client, advance } = world();
    event.answer = fault;
    await client.reader('player').readBytes(REFERENCE);
    advance(FAILING_AFTER_MS);
    await client.reader('player').readBytes(REFERENCE);
    expect(client.failures()).toHaveLength(1);

    event.answer = notFound;
    await client.reader('player').readBytes(REFERENCE);
    expect(client.failures()).toEqual([]);

    event.answer = fault;
    await client.reader('player').readBytes(REFERENCE);
    expect(client.failures(), 'the wait starts again').toEqual([]);
  });

  it('leaves a read its own caller stopped out of it', async () => {
    const { event, client, advance } = world();
    event.answer = { kind: 'aborted' };
    await client.reader('player').readBytes(REFERENCE);
    advance(FAILING_AFTER_MS);
    await client.reader('player').readBytes(REFERENCE);

    expect(client.failures()).toEqual([]);
  });

  it('forgets a part that stopped reading, since nothing on screen waits on it', async () => {
    const { event, client, advance } = world();
    event.answer = fault;
    await client.reader('player').readBytes(REFERENCE);
    advance(FAILING_AFTER_MS);
    await client.reader('player').readBytes(REFERENCE);
    advance(QUIET_AFTER_MS + 1);

    expect(client.failures()).toEqual([]);
  });

  it('keeps each part apart, each with the source it reads from', async () => {
    const { event, chat, client, advance } = world();
    chat.answer = fault;
    event.answer = content();
    await client.reader('chat').readChunk(REFERENCE);
    await client.reader('player').readBytes(REFERENCE);
    advance(FAILING_AFTER_MS);
    await client.reader('chat').readChunk(REFERENCE);
    await client.reader('player').readBytes(REFERENCE);

    expect(client.failures()).toEqual([
      { feature: 'chat', provider: 'chat-source', forMs: FAILING_AFTER_MS, cause: { kind: 'no-answer' } },
    ]);
  });

  it('fails a part whose feeds answer while the URLs the browser loads for it keep failing', async () => {
    const { event, client, advance } = world();
    event.answer = content();
    const player = client.reader('player');
    player.reportUrlLoad({ loaded: false, status: 503 });
    for (let turn = 0; turn < 5; turn += 1) {
      await player.readFeedEntry('1'.repeat(40), TOPIC, turn);
      advance(FAILING_AFTER_MS / 4);
    }
    player.reportUrlLoad({ loaded: false, status: 503 });

    expect(client.failures()).toEqual([
      {
        feature: 'player',
        provider: 'event',
        forMs: (5 * FAILING_AFTER_MS) / 4,
        cause: { kind: 'status', status: 503 },
      },
    ]);
  });

  it('clears that part at the first URL that loads, and counts one that never answered as no answer', async () => {
    const { client, advance } = world();
    const previews = client.reader('previews');
    previews.reportUrlLoad({ loaded: false, status: null });
    advance(FAILING_AFTER_MS);
    previews.reportUrlLoad({ loaded: false, status: null });
    expect(client.failures()[0]).toMatchObject({ feature: 'previews', cause: { kind: 'no-answer' } });

    previews.reportUrlLoad({ loaded: true });
    expect(client.failures()).toEqual([]);
  });
});
