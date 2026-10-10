import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  WEEB3_PEER_POLL_MS,
  WEEB3_START_DEADLINE_MS,
  Weeb3Runtime,
  type Weeb3Status,
} from '../../src/swarm/providers/weeb-3/weeb3Runtime';
import { fakeWeeb3Package } from '../helpers/fakeWeeb3';

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('the node in this browser', () => {
  it('loads the package once, from the copy served under /weeb-3/, and starts one node for the whole page', async () => {
    const fake = fakeWeeb3Package();
    const runtime = new Weeb3Runtime({ load: fake.load, isControlled: () => true });

    await Promise.all([runtime.start(), runtime.start()]);

    expect(fake.loads).toBe(1);
    expect(fake.initInputs).toEqual([{ module_or_path: '/weeb-3/weeb_3_bg.wasm' }]);
    expect(fake.nodes).toHaveLength(1);
    expect(fake.nodes[0].constructedWith).toEqual([undefined, '/']);
    expect(fake.nodes[0].started).toBe(1);
  });

  it('is starting until it has a peer and its service worker controls the page, then ready', async () => {
    const fake = fakeWeeb3Package();
    let controlled = false;
    const runtime = new Weeb3Runtime({ load: fake.load, isControlled: () => controlled });
    const seen: Weeb3Status[] = [];
    runtime.subscribe((status) => seen.push(status));

    await runtime.start();
    expect(runtime.status()).toEqual({ state: 'starting', peers: 0 });

    fake.nodes[0].peers = 3;
    await vi.advanceTimersByTimeAsync(WEEB3_PEER_POLL_MS);
    expect(runtime.status()).toEqual({ state: 'starting', peers: 3 });

    controlled = true;
    await vi.advanceTimersByTimeAsync(WEEB3_PEER_POLL_MS);
    expect(runtime.status()).toEqual({ state: 'ready', peers: 3 });
    expect(seen.at(-1)).toEqual({ state: 'ready', peers: 3 });
  });

  it('keeps counting peers once ready', async () => {
    const fake = fakeWeeb3Package();
    const runtime = new Weeb3Runtime({ load: fake.load, isControlled: () => true });
    await runtime.start();
    fake.nodes[0].peers = 1;
    await vi.advanceTimersByTimeAsync(WEEB3_PEER_POLL_MS);
    fake.nodes[0].peers = 7;
    await vi.advanceTimersByTimeAsync(WEEB3_PEER_POLL_MS);

    expect(runtime.status()).toEqual({ state: 'ready', peers: 7 });
  });

  it('fails when the package cannot load, and says so to whoever waits on it', async () => {
    const fake = fakeWeeb3Package({ initFails: true });
    const runtime = new Weeb3Runtime({ load: fake.load, isControlled: () => true });

    await expect(runtime.start()).rejects.toThrow();
    expect(runtime.status().state).toBe('failed');
  });

  it('fails when no peer comes within the start deadline', async () => {
    const fake = fakeWeeb3Package();
    const runtime = new Weeb3Runtime({ load: fake.load, isControlled: () => true });
    await runtime.start();

    await vi.advanceTimersByTimeAsync(WEEB3_START_DEADLINE_MS);

    expect(runtime.status().state).toBe('failed');
  });

  it('frees the node on stop and can start a new one after', async () => {
    const fake = fakeWeeb3Package();
    const runtime = new Weeb3Runtime({ load: fake.load, isControlled: () => true });
    await runtime.start();
    await runtime.stop();

    expect(fake.nodes[0].freed).toBe(true);
    expect(runtime.status()).toEqual({ state: 'stopped', peers: 0 });

    await runtime.start();
    expect(fake.nodes).toHaveLength(2);
  });

  it('answers the started node to a caller that needs it, such as the player', async () => {
    const fake = fakeWeeb3Package();
    const runtime = new Weeb3Runtime({ load: fake.load, isControlled: () => true });

    expect(await runtime.start()).toBe(fake.nodes[0]);
  });
});
