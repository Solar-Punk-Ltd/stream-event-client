import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  WEEB3_PEER_POLL_MS,
  WEEB3_START_DEADLINE_MS,
  Weeb3Runtime,
  type Weeb3Status,
} from '../../src/swarm/providers/weeb-3/weeb3Runtime';
import { fakeWeeb3Package } from '../helpers/fakeWeeb3';

const WASM = new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0]);

/** Serves the WebAssembly module in two halves, the way a stream delivers it, logging what was asked. */
function wasmFetch(asked: string[] = [], options: { status?: number; length?: boolean } = {}): typeof fetch {
  return (async (input: RequestInfo | URL) => {
    asked.push(String(input));
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(WASM.slice(0, 4));
        controller.enqueue(WASM.slice(4));
        controller.close();
      },
    });
    const headers: Record<string, string> = options.length === false ? {} : { 'content-length': String(WASM.length) };
    return new Response(body, { status: options.status ?? 200, headers });
  }) as typeof fetch;
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('the node in this browser', () => {
  it('loads the package once, its module downloaded from the copy served under /weeb-3/, and starts one node for the whole page', async () => {
    const fake = fakeWeeb3Package();
    const asked: string[] = [];
    const runtime = new Weeb3Runtime({ load: fake.load, isControlled: () => true, fetcher: wasmFetch(asked) });

    await Promise.all([runtime.start(), runtime.start()]);

    expect(fake.loads).toBe(1);
    expect(asked).toEqual(['/weeb-3/weeb_3_bg.wasm']);
    expect(fake.initInputs).toEqual([{ module_or_path: WASM }]);
    expect(fake.nodes).toHaveLength(1);
    expect(fake.nodes[0].constructedWith).toEqual([undefined, '/']);
    expect(fake.nodes[0].started).toBe(1);
  });

  it('is starting until it has a peer and its service worker controls the page, then ready', async () => {
    const fake = fakeWeeb3Package();
    let controlled = false;
    const runtime = new Weeb3Runtime({ load: fake.load, isControlled: () => controlled, fetcher: wasmFetch() });
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
    const runtime = new Weeb3Runtime({ load: fake.load, isControlled: () => true, fetcher: wasmFetch() });
    await runtime.start();
    fake.nodes[0].peers = 1;
    await vi.advanceTimersByTimeAsync(WEEB3_PEER_POLL_MS);
    fake.nodes[0].peers = 7;
    await vi.advanceTimersByTimeAsync(WEEB3_PEER_POLL_MS);

    expect(runtime.status()).toEqual({ state: 'ready', peers: 7 });
  });

  it('reports how much of the module has arrived, out of the length the server named, then starting', async () => {
    const fake = fakeWeeb3Package();
    const runtime = new Weeb3Runtime({ load: fake.load, isControlled: () => true, fetcher: wasmFetch() });
    const seen: Weeb3Status[] = [];
    runtime.subscribe((status) => seen.push(status));

    await runtime.start();

    expect(seen).toEqual([
      { state: 'starting', peers: 0, download: { receivedBytes: 0, totalBytes: null } },
      { state: 'starting', peers: 0, download: { receivedBytes: 0, totalBytes: 8 } },
      { state: 'starting', peers: 0, download: { receivedBytes: 4, totalBytes: 8 } },
      { state: 'starting', peers: 0, download: { receivedBytes: 8, totalBytes: 8 } },
      { state: 'starting', peers: 0 },
    ]);
  });

  it("counts against the module's size the build recorded, which a compressing server's answer leaves out", async () => {
    const fake = fakeWeeb3Package();
    const runtime = new Weeb3Runtime({
      load: fake.load,
      isControlled: () => true,
      fetcher: wasmFetch([], { length: false }),
      wasmBytes: 8,
    });
    const seen: Weeb3Status[] = [];
    runtime.subscribe((status) => seen.push(status));

    await runtime.start();

    expect(seen).toContainEqual({ state: 'starting', peers: 0, download: { receivedBytes: 4, totalBytes: 8 } });
  });

  it('reports the bytes alone when the server names no length', async () => {
    const fake = fakeWeeb3Package();
    const runtime = new Weeb3Runtime({
      load: fake.load,
      isControlled: () => true,
      fetcher: wasmFetch([], { length: false }),
    });
    const seen: Weeb3Status[] = [];
    runtime.subscribe((status) => seen.push(status));

    await runtime.start();

    expect(seen).toContainEqual({ state: 'starting', peers: 0, download: { receivedBytes: 8, totalBytes: null } });
  });

  it('fails when the module cannot be downloaded', async () => {
    const fake = fakeWeeb3Package();
    const runtime = new Weeb3Runtime({
      load: fake.load,
      isControlled: () => true,
      fetcher: wasmFetch([], { status: 404 }),
    });

    await expect(runtime.start()).rejects.toThrow();
    expect(runtime.status().state).toBe('failed');
    expect(fake.initInputs).toEqual([]);
  });

  it('fails when the package cannot load, and says so to whoever waits on it', async () => {
    const fake = fakeWeeb3Package({ initFails: true });
    const runtime = new Weeb3Runtime({ load: fake.load, isControlled: () => true, fetcher: wasmFetch() });

    await expect(runtime.start()).rejects.toThrow();
    expect(runtime.status().state).toBe('failed');
  });

  it('fails when no peer comes within the start deadline', async () => {
    const fake = fakeWeeb3Package();
    const runtime = new Weeb3Runtime({ load: fake.load, isControlled: () => true, fetcher: wasmFetch() });
    await runtime.start();

    await vi.advanceTimersByTimeAsync(WEEB3_START_DEADLINE_MS);

    expect(runtime.status().state).toBe('failed');
  });

  it('runs while anything holds it, and the last release stops and frees it', async () => {
    const fake = fakeWeeb3Package();
    const runtime = new Weeb3Runtime({ load: fake.load, isControlled: () => true, fetcher: wasmFetch() });

    await Promise.all([runtime.acquire(), runtime.acquire()]);
    runtime.release();
    await vi.advanceTimersByTimeAsync(0);
    expect(fake.nodes[0].freed).toBe(false);
    expect(runtime.status().state).toBe('starting');

    runtime.release();
    await vi.advanceTimersByTimeAsync(0);
    expect(fake.nodes[0].freed).toBe(true);
    expect(runtime.status().state).toBe('stopped');

    runtime.release();
    await runtime.acquire();
    expect(fake.nodes).toHaveLength(2);
  });

  it('makes no node once it was stopped while still starting', async () => {
    const fake = fakeWeeb3Package();
    const runtime = new Weeb3Runtime({ load: fake.load, isControlled: () => true, fetcher: wasmFetch() });

    const starting = runtime.acquire();
    runtime.release();
    void runtime.stop();

    await expect(starting).rejects.toThrow();
    expect(fake.nodes).toEqual([]);
  });

  it('keeps the node for a holder that takes over in the same tick as the last one lets go', async () => {
    const fake = fakeWeeb3Package();
    const runtime = new Weeb3Runtime({ load: fake.load, isControlled: () => true, fetcher: wasmFetch() });
    await runtime.acquire();

    runtime.release();
    await runtime.acquire();
    await vi.advanceTimersByTimeAsync(0);

    expect(fake.nodes).toHaveLength(1);
    expect(fake.nodes[0].freed).toBe(false);
  });

  it('answers the node once it is ready, and refuses once it fails', async () => {
    const fake = fakeWeeb3Package();
    const runtime = new Weeb3Runtime({ load: fake.load, isControlled: () => true, fetcher: wasmFetch() });
    await runtime.acquire();
    let ready: unknown = null;
    void runtime.whenReady().then((node) => (ready = node));

    await vi.advanceTimersByTimeAsync(WEEB3_PEER_POLL_MS);
    expect(ready).toBeNull();
    fake.nodes[0].peers = 2;
    await vi.advanceTimersByTimeAsync(WEEB3_PEER_POLL_MS);
    expect(ready).toBe(fake.nodes[0]);

    const failing = new Weeb3Runtime({
      load: fake.load,
      isControlled: () => true,
      fetcher: wasmFetch([], { status: 500 }),
    });
    await failing.acquire().catch(() => undefined);
    await expect(failing.whenReady()).rejects.toThrow('failed to start');
  });

  it('frees the node on stop and can start a new one after', async () => {
    const fake = fakeWeeb3Package();
    const runtime = new Weeb3Runtime({ load: fake.load, isControlled: () => true, fetcher: wasmFetch() });
    await runtime.start();
    await runtime.stop();

    expect(fake.nodes[0].freed).toBe(true);
    expect(runtime.status()).toEqual({ state: 'stopped', peers: 0 });

    await runtime.start();
    expect(fake.nodes).toHaveLength(2);
  });

  it('answers the started node to a caller that needs it, such as the player', async () => {
    const fake = fakeWeeb3Package();
    const runtime = new Weeb3Runtime({ load: fake.load, isControlled: () => true, fetcher: wasmFetch() });

    expect(await runtime.start()).toBe(fake.nodes[0]);
  });
});
