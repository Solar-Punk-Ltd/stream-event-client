import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  type GentleCounts,
  GentleFetcher,
  type GentleRoute,
  readSwarmIdFetches,
  SWARM_ID_FETCHES_FILE,
  SWARM_ID_IN_FLIGHT,
  SWARM_ID_RETRY_DELAYS_MS,
  SWARM_ID_START_GAP_MS,
  swarmIdFetchFinding,
  SwarmIdPacer,
} from '../src/gentleFetch.ts';

const ORIGIN = 'https://id.example.com';

interface FakeResponse {
  status(): number;
}

/** A route whose fetch answers from `answer`, one call at a time, and that records how it was settled. */
function fakeRoute(url: string, answer: (attempt: number) => Promise<number>) {
  let attempts = 0;
  const route = {
    settled: null as null | { fulfilled: number } | { aborted: string } | 'fallback',
    get attempts() {
      return attempts;
    },
    request: () => ({ url: () => url }),
    async fetch(): Promise<FakeResponse> {
      const status = await answer(attempts++);
      return { status: () => status };
    },
    async fulfill({ response }: { response: FakeResponse }) {
      route.settled = { fulfilled: response.status() };
    },
    async fallback() {
      route.settled = 'fallback';
    },
    async abort(code?: string) {
      route.settled = { aborted: code ?? '' };
    },
  };
  return route satisfies GentleRoute<FakeResponse>;
}

const noWait = () => {
  const waited: number[] = [];
  return { waited, sleep: async (ms: number) => void waited.push(ms), pacer: new SwarmIdPacer({ startGapMs: 0 }) };
};

/** A clock that only moves when something sleeps on it. */
const fakeClock = () => {
  let now = 0;
  return { now: () => now, sleep: async (ms: number) => void (now += ms) };
};

describe('SwarmIdPacer', () => {
  it("keeps one cap over every actor's fetches of a run, not one cap each", async () => {
    let inFlight = 0;
    let most = 0;
    const releases: (() => void)[] = [];
    const answer = () =>
      new Promise<number>((resolve) => {
        inFlight++;
        most = Math.max(most, inFlight);
        releases.push(() => {
          inFlight--;
          resolve(200);
        });
      });
    const pacer = new SwarmIdPacer({ startGapMs: 0 });
    const alice = new GentleFetcher<FakeResponse>(ORIGIN, { ...noWait(), pacer });
    const bob = new GentleFetcher<FakeResponse>(ORIGIN, { ...noWait(), pacer });
    const routes = Array.from({ length: 12 }, (_, n) => fakeRoute(`${ORIGIN}/_app/${n}.js`, answer));
    const handled = routes.map((route, n) => (n % 2 ? alice : bob).handle(route));
    while (routes.some((route) => route.settled === null)) {
      await new Promise((resolve) => setTimeout(resolve, 0));
      releases.shift()?.();
    }
    await Promise.all(handled);
    expect(most).toBe(SWARM_ID_IN_FLIGHT);
  });

  it('starts one fetch no sooner than its gap after the one before', async () => {
    const clock = fakeClock();
    const pacer = new SwarmIdPacer({ inFlight: 10, ...clock });
    const started: number[] = [];
    for (let n = 0; n < 5; n++) {
      await pacer.acquire();
      started.push(clock.now());
      pacer.release();
    }
    const gaps = started.slice(1).map((at, n) => at - started[n]!);
    expect(gaps).toEqual([SWARM_ID_START_GAP_MS, SWARM_ID_START_GAP_MS, SWARM_ID_START_GAP_MS, SWARM_ID_START_GAP_MS]);
  });

  it('gives its slot back while a file waits to be asked again, so a retry does not hold up the others', async () => {
    const pacer = new SwarmIdPacer({ inFlight: 1, startGapMs: 0 });
    let resume: () => void = () => undefined;
    const fetcher = new GentleFetcher<FakeResponse>(ORIGIN, {
      pacer,
      sleep: () => new Promise<void>((resolve) => (resume = resolve)),
    });
    const failing = fakeRoute(`${ORIGIN}/_app/slow.js`, async (attempt) => (attempt === 0 ? 500 : 200));
    const other = fakeRoute(`${ORIGIN}/_app/other.js`, async () => 200);
    const first = fetcher.handle(failing);
    await new Promise((resolve) => setTimeout(resolve, 0));
    await fetcher.handle(other);
    expect(other.settled).toEqual({ fulfilled: 200 });
    resume();
    await first;
    expect(failing.settled).toEqual({ fulfilled: 200 });
  });
});

describe('GentleFetcher', () => {
  it('keeps at most its cap of Swarm ID fetches in flight and still answers every one', async () => {
    let inFlight = 0;
    let most = 0;
    const releases: (() => void)[] = [];
    const answer = () =>
      new Promise<number>((resolve) => {
        inFlight++;
        most = Math.max(most, inFlight);
        releases.push(() => {
          inFlight--;
          resolve(200);
        });
      });
    const fetcher = new GentleFetcher<FakeResponse>(ORIGIN, noWait());
    const routes = Array.from({ length: 10 }, (_, n) => fakeRoute(`${ORIGIN}/_app/${n}.js`, answer));
    const handled = routes.map((route) => fetcher.handle(route));
    while (routes.some((route) => route.settled === null)) {
      await new Promise((resolve) => setTimeout(resolve, 0));
      releases.shift()?.();
    }
    await Promise.all(handled);
    expect(most).toBe(SWARM_ID_IN_FLIGHT);
    expect(routes.every((route) => JSON.stringify(route.settled) === '{"fulfilled":200}')).toBe(true);
    expect(fetcher.counts).toMatchObject({ requests: 10, serverErrors: 0, retries: 0 });
  });

  it('asks again after a 500, fulfills the 200 that followed and counts one retry', async () => {
    const wait = noWait();
    const fetcher = new GentleFetcher<FakeResponse>(ORIGIN, wait);
    const route = fakeRoute(`${ORIGIN}/_app/a.js`, async (attempt) => (attempt === 0 ? 500 : 200));
    await fetcher.handle(route);
    expect(route.settled).toEqual({ fulfilled: 200 });
    expect(wait.waited).toEqual([SWARM_ID_RETRY_DELAYS_MS[0]]);
    expect(fetcher.counts).toEqual({
      requests: 1,
      serverErrors: 1,
      networkErrors: 0,
      retries: 1,
      filesRetried: 1,
      stillFailed: 0,
    });
  });

  it('gives up after its attempts on a file that always answers 500 and fulfills that 500', async () => {
    const wait = noWait();
    const fetcher = new GentleFetcher<FakeResponse>(ORIGIN, wait);
    const route = fakeRoute(`${ORIGIN}/_app/b.js`, async () => 500);
    await fetcher.handle(route);
    const attempts = SWARM_ID_RETRY_DELAYS_MS.length + 1;
    expect(route.attempts).toBe(attempts);
    expect(route.settled).toEqual({ fulfilled: 500 });
    expect(wait.waited).toEqual([...SWARM_ID_RETRY_DELAYS_MS]);
    expect(fetcher.counts).toEqual({
      requests: 1,
      serverErrors: attempts,
      networkErrors: 0,
      retries: attempts - 1,
      filesRetried: 1,
      stillFailed: 1,
    });
  });

  it('retries a network error and fails the request when every attempt failed', async () => {
    const fetcher = new GentleFetcher<FakeResponse>(ORIGIN, noWait());
    const route = fakeRoute(`${ORIGIN}/connect`, async () => {
      throw new Error('socket hang up');
    });
    await fetcher.handle(route);
    expect(route.settled).toEqual({ aborted: 'failed' });
    expect(fetcher.counts).toMatchObject({ networkErrors: SWARM_ID_RETRY_DELAYS_MS.length + 1, stillFailed: 1 });
  });

  it('leaves a request to any other origin to the next route and counts nothing', async () => {
    const fetcher = new GentleFetcher<FakeResponse>(ORIGIN, noWait());
    const route = fakeRoute('https://viewer.example.com/app.js', async () => 200);
    await fetcher.handle(route);
    expect(route.settled).toBe('fallback');
    expect(route.attempts).toBe(0);
    expect(fetcher.counts.requests).toBe(0);
  });
});

const counts = (over: Partial<GentleCounts>): GentleCounts => ({
  requests: 40,
  serverErrors: 0,
  networkErrors: 0,
  retries: 0,
  filesRetried: 0,
  stillFailed: 0,
  ...over,
});

describe('readSwarmIdFetches', () => {
  it('reads each actor folder’s counts and skips a folder without them', () => {
    const dir = mkdtempSync(join(tmpdir(), 'kit-gentle-'));
    const alice = join(dir, 'alice');
    const bob = join(dir, 'bob');
    mkdirSync(alice);
    mkdirSync(bob);
    writeFileSync(join(alice, SWARM_ID_FETCHES_FILE), JSON.stringify(counts({ serverErrors: 3, retries: 3 })));
    expect(readSwarmIdFetches([alice, bob])).toEqual({ alice: counts({ serverErrors: 3, retries: 3 }) });
  });
});

describe('swarmIdFetchFinding', () => {
  it('sums every actor’s server errors, retries and files that still failed, and names the cause on a failed run', () => {
    const finding = swarmIdFetchFinding(false, {
      alice: counts({ serverErrors: 13, retries: 14, filesRetried: 11, stillFailed: 1, networkErrors: 1 }),
      bob: counts({ serverErrors: 2, retries: 2, filesRetried: 2 }),
    });
    expect(finding).toMatchObject({
      serverErrors: 15,
      networkErrors: 1,
      retries: 16,
      filesRetried: 13,
      stillFailed: 1,
      byActor: { alice: { serverErrors: 13 }, bob: { retries: 2 } },
    });
    expect(String(finding?.cause)).toMatch(/500/);
  });

  it('records the counts without a cause on a passed run, zeros included, and nothing without counts', () => {
    const passed = swarmIdFetchFinding(true, { alice: counts({ serverErrors: 4, retries: 4, filesRetried: 4 }) });
    expect(passed).toMatchObject({ serverErrors: 4, stillFailed: 0 });
    expect(passed?.cause).toBeUndefined();
    expect(swarmIdFetchFinding(false, { alice: counts({}) })).toMatchObject({ serverErrors: 0, retries: 0 });
    expect(swarmIdFetchFinding(false, { alice: counts({}) })?.cause).toBeUndefined();
    expect(swarmIdFetchFinding(true, {})).toBeNull();
  });
});
