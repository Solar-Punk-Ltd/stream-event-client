import { describe, expect, it } from 'vitest';

import type { FeedEntry } from '../src/chatFeed.ts';
import { followFeed } from '../src/liveFeed.ts';

const text = (payload: Uint8Array) => new TextDecoder().decode(payload);
const decode = (payload: Uint8Array, index: number): FeedEntry => ({
  index,
  ok: true,
  text: text(payload),
  via: 'gateway' as FeedEntry extends { via: infer V } ? V : never,
  account: null,
  addr: 'cc'.repeat(20),
});

/** A feed whose slots are written as `written` says, read slot by slot, which records every slot asked. */
function feed(slots: string[]) {
  const asked: number[] = [];
  let written = slots.length;
  return {
    asked,
    write(more: string) {
      slots.push(more);
      written = slots.length;
    },
    read: async (index: number) => {
      asked.push(index);
      return index < written ? new TextEncoder().encode(slots[index]) : null;
    },
  };
}

const noWait = async () => undefined;

describe('followFeed', () => {
  it('reads from the first slot to the first unwritten one and returns once every text is there', async () => {
    const chat = feed(['old', 'mine one', 'mine two']);
    const { entries, unwrittenAsks } = await followFeed(chat.read, decode, ['mine one', 'mine two'], {
      timeoutMs: 1000,
      intervalMs: 10,
      sleep: noWait,
    });
    expect(entries.map((entry) => entry.index)).toEqual([0, 1, 2]);
    expect(chat.asked).toEqual([0, 1, 2, 3]);
    expect(unwrittenAsks).toBe(1);
  });

  it('never reads a written slot twice, and asks only the next unwritten slot while it waits', async () => {
    const chat = feed(['old']);
    let rounds = 0;
    const sleep = async () => {
      rounds++;
      if (rounds === 2) chat.write('late');
    };
    const { entries, unwrittenAsks } = await followFeed(chat.read, decode, ['late'], {
      timeoutMs: 60_000,
      intervalMs: 10_000,
      sleep,
    });
    expect(entries.map((entry) => (entry as { text: string }).text)).toEqual(['old', 'late']);
    expect(chat.asked).toEqual([0, 1, 1, 1, 2]);
    expect(unwrittenAsks).toBe(3);
  });

  it('gives up at its bound, saying it waited on the feed alone', async () => {
    const chat = feed(['old']);
    let clock = 0;
    await expect(
      followFeed(chat.read, decode, ['never'], {
        timeoutMs: 30_000,
        intervalMs: 10_000,
        sleep: async (ms) => {
          clock += ms;
        },
        now: () => clock,
      }),
    ).rejects.toThrow(/"never" after 30000 ms.*feed alone/);
    expect(chat.asked.filter((index) => index === 1).length).toBeLessThanOrEqual(4);
  });
});
