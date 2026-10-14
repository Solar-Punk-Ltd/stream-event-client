import { Topic } from '@ethersphere/bee-js';
import { describe, expect, it } from 'vitest';

import { statusRows } from '../../src/features/gateway/providerStatus';
import { SwarmClient } from '../../src/swarm/client';
import { content, fault, notFound, ScriptedProvider } from '../helpers/scriptedProvider';

const OWNER = '1'.repeat(40);
const TOPIC = Topic.fromString('status-test');
const NAMES: Record<string, string> = {
  event: 'Event gateway',
  'chat-read': "The chat's gateway",
};
const nameOf = (id: string) => NAMES[id] ?? id;

function world() {
  const event = new ScriptedProvider('event');
  const chat = new ScriptedProvider('chat');
  let nowMs = 1_000_000;
  const client = new SwarmClient({
    chosen: { id: 'event', provider: event },
    routes: { chat: { id: 'chat-read', provider: chat } },
    now: () => nowMs,
  });
  return { event, chat, client, advance: (ms: number) => (nowMs += ms) };
}

describe('the status view', () => {
  it('says, per feature, who it reads from and what answered in the last minute', async () => {
    const { event, client } = world();
    event.answer = content();
    await client.reader('player').readFeedEntry(OWNER, TOPIC, 1);
    event.answer = notFound;
    await client.reader('player').readFeedEntry(OWNER, TOPIC, 2);
    event.answer = fault;
    await client.reader('stream-list').readFeedHead(OWNER, TOPIC);
    await client.reader('stream-list').readFeedHead(OWNER, TOPIC);

    expect(statusRows(client.activity(), nameOf)).toEqual([
      {
        feature: 'player',
        label: 'Video',
        route: 'Reads from Event gateway.',
        answered: 'In the last minute, Event gateway: 1 served, 1 not there yet.',
      },
      {
        feature: 'stream-list',
        label: 'Stream list',
        route: 'Reads from Event gateway.',
        answered: 'In the last minute, Event gateway: 2 failed.',
      },
      {
        feature: 'previews',
        label: 'Previews and pictures',
        route: 'Reads from Event gateway.',
        answered: 'Nothing read in the last minute.',
      },
      {
        feature: 'chat',
        label: 'Chat',
        route: "Reads from The chat's gateway.",
        answered: 'Nothing read in the last minute.',
      },
    ]);
  });

  it('forgets what answered more than a minute ago', async () => {
    const { event, client, advance } = world();
    event.answer = content();
    await client.reader('player').readFeedEntry(OWNER, TOPIC, 1);
    advance(60_001);

    expect(statusRows(client.activity(), nameOf)[0].answered).toBe('Nothing read in the last minute.');
  });
});
