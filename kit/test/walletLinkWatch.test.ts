import { describe, expect, it } from 'vitest';

import { ENS_LINK_LIVE_WAIT_MS, ensLinkWaitMs, watchWalletLink } from '../src/walletLinkWatch.ts';

const WALLET = '0xC63A26c0FF9C8ae00F86A3f8810C57eb0fb16c1A';
const update = (wallet: string | null) =>
  JSON.stringify({ type: 'connectionInfoChanged', identity: { name: 'alice', ...(wallet ? { wallet } : {}) } });

/** A clock that moves only when the watch sleeps, and a frame whose messages appear at set times. */
function frame(messages: [atMs: number, line: string][]) {
  let now = 0;
  return {
    now: () => now,
    sleep: async (ms: number) => void (now += ms),
    received: async () =>
      messages
        .filter(([at]) => at <= now)
        .map(([, line]) => line)
        .join('\n'),
  };
}

describe('ensLinkWaitMs', () => {
  it('waits longer live, where Swarm ID can take most of a minute to start after a reload', () => {
    expect(ensLinkWaitMs(true)).toBe(ENS_LINK_LIVE_WAIT_MS);
    expect(ensLinkWaitMs(false)).toBeLessThan(ENS_LINK_LIVE_WAIT_MS);
  });
});

describe('watchWalletLink', () => {
  it("says when the frame's first update came and when the wanted one did", async () => {
    const clock = frame([
      [56_000, update(WALLET)],
      [58_000, update(null)],
    ]);
    const watched = await watchWalletLink({
      ...clock,
      wallet: WALLET,
      wanted: 'update carried no wallet',
      waitMs: 120_000,
    });
    expect(watched).toEqual({ seen: 'update carried no wallet', firstUpdateMs: 56_000, wantedMs: 58_000 });
  });

  it('gives up at its wait and says no update came', async () => {
    const clock = frame([[130_000, update(null)]]);
    const watched = await watchWalletLink({
      ...clock,
      wallet: WALLET,
      wanted: 'update carried no wallet',
      waitMs: 120_000,
    });
    expect(watched).toEqual({ seen: 'no update', firstUpdateMs: null, wantedMs: null });
  });
});
