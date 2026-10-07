import { expect, test, type BrowserContext, type Page } from '@playwright/test';

import {
  installHlsProbe,
  levelUris,
  playingUri,
  probeState,
  switchAtFirstFragment,
  switchTo,
  videoTime,
} from './hlsProbe';
import { refuseOtherOrigins, serveConfig } from './journey';
import { LadderGateway, RUNGS, rungUri, type RungName } from './ladderGateway';

/**
 * Real hls.js against a live stream in four qualities, served by a fake gateway inside Playwright. Each journey
 * checks what the player reads and what it plays. Timings are printed for the live check to compare against, and
 * never asserted, so the waits are generous.
 */

const TOP: RungName = '720p';
/** Seconds the video must move on by for playback to count as carrying on. */
const PLAYS_ON_S = 3;
/**
 * How long a quality left behind is watched for further reads, and the quality playing is watched for its read rate.
 * Fifteen seconds is about seven segments, so a rate printed from it moves in steps of four reads a minute.
 */
const QUIET_WATCH_MS = 15_000;
/** Longer than a failover can take: 8 s unserved, then up to 6 s of the sibling, then hls.js's switch. */
const FAILOVER_WAIT_MS = 45_000;

test.describe.configure({ timeout: 120_000 });

/** Prints one journey's numbers on a line of its own, where the run's output keeps them. */
function report(journey: string, numbers: Record<string, unknown>): void {
  console.log(`[ladder] ${journey} ${JSON.stringify(numbers)}`);
}

/**
 * Serves the page through the fake gateway and opens the stream's watch page, without waiting for anything.
 *
 * @param switchAtFirstFragmentTo A quality hls.js is asked to switch to the moment its first fragment is buffered.
 */
async function openPage(
  page: Page,
  context: BrowserContext,
  gateway: LadderGateway,
  switchAtFirstFragmentTo?: RungName,
): Promise<string[]> {
  await refuseOtherOrigins(context);
  await installHlsProbe(page);
  if (switchAtFirstFragmentTo) {
    await switchAtFirstFragment(page, rungUri(switchAtFirstFragmentTo));
  }
  await serveConfig(page, gateway.config());
  await gateway.attach(page);
  const warnings: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'warning') {
      warnings.push(message.text().slice(0, 200));
    }
  });
  await page.goto(gateway.watchPath());
  return warnings;
}

/**
 * Opens the stream and waits until it plays and hls.js has reported the quality it started on, so a journey's own
 * switch is never mistaken for the start.
 */
async function openStream(
  page: Page,
  context: BrowserContext,
  gateway: LadderGateway,
): Promise<{ firstFrameMs: number; firstFrameAtMs: number; warnings: string[] }> {
  const openedAtMs = Date.now();
  const warnings = await openPage(page, context, gateway);
  await expect
    .poll(() => videoTime(page), { message: 'the stream plays past 1 s', timeout: 30_000 })
    .toBeGreaterThan(1);
  const firstFrameAtMs = Date.now();
  const firstFrameMs = firstFrameAtMs - openedAtMs;
  await expect
    .poll(async () => (await probeState(page)).switches.length, {
      message: 'hls.js reports the quality it started on',
      timeout: 20_000,
    })
    .toBeGreaterThan(0);
  return { firstFrameMs, firstFrameAtMs, warnings };
}

/** Reads per minute of one quality's feed over a stretch, in all and by kind, which is what one viewer costs the gateway. */
function readRates(
  gateway: LadderGateway,
  rung: RungName,
  sinceMs: number,
  untilMs: number,
): { all: number; slot: number; miss: number; head: number } {
  const perMinute = (kinds: readonly string[]) =>
    Math.round(
      (gateway.requests.filter(
        (request) =>
          request.rung === rung && kinds.includes(request.kind) && request.atMs >= sinceMs && request.atMs < untilMs,
      ).length *
        60_000) /
        (untilMs - sinceMs),
    );
  return {
    all: perMinute(['slot', 'miss', 'head']),
    slot: perMinute(['slot']),
    miss: perMinute(['miss']),
    head: perMinute(['head']),
  };
}

/**
 * The most times one published index of a quality was read since a moment. A quality found once and then followed
 * reads each of its slots once. A quality started over is searched again, which reads slots it already holds.
 */
function mostReadsOfOneSlot(gateway: LadderGateway, rung: RungName, sinceMs: number): number {
  const reads = new Map<number, number>();
  for (const request of gateway.requests) {
    if (request.rung === rung && request.kind === 'slot' && request.atMs >= sinceMs && request.index !== null) {
      reads.set(request.index, (reads.get(request.index) ?? 0) + 1);
    }
  }
  return Math.max(0, ...reads.values());
}

/** Waits for the video to move on by {@link PLAYS_ON_S} seconds from where it is now. */
async function expectPlaysOn(page: Page, why: string): Promise<void> {
  const from = await videoTime(page);
  await expect
    .poll(() => videoTime(page), { message: `${why}: the video moves on from ${from.toFixed(1)} s`, timeout: 20_000 })
    .toBeGreaterThan(from + PLAYS_ON_S);
}

async function waitForSwitchTo(page: Page, rung: RungName, sinceMs: number, timeout: number): Promise<number> {
  const uri = rungUri(rung);
  await expect
    .poll(async () => (await probeState(page)).switches.some((s) => s.uri === uri && s.atMs >= sinceMs), {
      message: `hls.js switches to ${rung}`,
      timeout,
    })
    .toBe(true);
  const switched = (await probeState(page)).switches.find((s) => s.uri === uri && s.atMs >= sinceMs);
  return switched!.atMs;
}

async function expectNoFatalErrorOrRestart(page: Page): Promise<void> {
  const state = await probeState(page);
  expect(state.fatalErrors, 'hls.js raised no fatal error').toEqual([]);
  expect(state.created, 'the player was built once and never restarted').toBe(1);
}

function expectOnlyKnownRequests(gateway: LadderGateway): void {
  expect(gateway.unknownPaths(), 'every request was one the fake gateway knows').toEqual([]);
}

for (const markers of [true, false]) {
  const journey = markers ? 'start' : 'start without markers';
  test(`${journey}: the master feed is never read and only the starting quality is`, async ({ page, context }) => {
    const gateway = new LadderGateway({ markers });
    const { firstFrameMs, firstFrameAtMs, warnings } = await openStream(page, context, gateway);
    const starting = await playingUri(page);
    const rung = RUNGS.find((candidate) => rungUri(candidate.name) === starting)?.name;
    expect(rung, `the player plays one of the four qualities, not ${starting}`).toBeDefined();
    const watchFromMs = Date.now();
    await page.waitForTimeout(QUIET_WATCH_MS);

    report(journey, {
      firstFrameMs,
      startingQuality: rung,
      requestsToFirstFrame: gateway.tally(0, firstFrameAtMs),
      readsPerMinute: readRates(gateway, rung!, watchFromMs, Date.now()),
      requests: gateway.tally(),
      warnings,
    });
    expect(gateway.count('master'), 'nothing is read for the master feed (decision 33)').toBe(0);
    expect(gateway.count('head', rung!), 'the starting quality is found by its slots, never the head lookup').toBe(0);
    expect(gateway.feedReads(rung!), 'the starting quality is read').toBeGreaterThan(0);
    if (markers) {
      expect(gateway.count('marker'), 'the start read a time marker (decision 35)').toBeGreaterThan(0);
    } else {
      expect(gateway.count('marker'), 'no marker was there to read').toBe(0);
      expect(gateway.count('markerMiss'), 'the two recent periods were asked once each').toBeLessThanOrEqual(2);
    }
    for (const other of RUNGS.filter((candidate) => candidate.name !== rung)) {
      expect(gateway.feedReads(other.name), `${other.name} is not read`).toBe(0);
      expect(gateway.count('segment', other.name), `no ${other.name} segment is fetched`).toBe(0);
    }
    await expectNoFatalErrorOrRestart(page);
    expectOnlyKnownRequests(gateway);
  });
}

test('a forced switch moves the reads to the new quality and keeps playing', async ({ page, context }) => {
  const gateway = new LadderGateway();
  const { warnings } = await openStream(page, context, gateway);
  expect(await playingUri(page), `the player starts on ${TOP}`).toBe(rungUri(TOP));

  const target: RungName = '360p';
  const askedAtMs = Date.now();
  await switchTo(page, rungUri(target));
  const switchedAtMs = await waitForSwitchTo(page, target, askedAtMs, 30_000);
  await expectPlaysOn(page, 'after the switch');
  // A read already in flight when hls.js switched may still land, so the old quality is watched from a moment later.
  const quietFromMs = switchedAtMs + 1_000;
  await page.waitForTimeout(QUIET_WATCH_MS);

  report('switch', {
    from: TOP,
    to: target,
    switchMs: switchedAtMs - askedAtMs,
    targetReadsPerMinute: readRates(gateway, target, quietFromMs, Date.now()),
    requestsBeforeAsk: gateway.tally(0, askedAtMs),
    requestsSinceAsk: gateway.tally(askedAtMs),
    warnings,
  });
  expect(gateway.count('head', target), `${target} is found by its slots, never the head lookup`).toBe(0);
  expect(gateway.count('segment', target, askedAtMs), `${target} segments are fetched`).toBeGreaterThan(0);
  expect(gateway.feedReads(TOP, quietFromMs), `${TOP} is no longer read after the switch`).toBe(0);
  for (const other of RUNGS.filter((candidate) => candidate.name !== TOP && candidate.name !== target)) {
    expect(gateway.feedReads(other.name), `${other.name} is never read`).toBe(0);
  }
  expect(gateway.count('master'), 'nothing is read for the master feed').toBe(0);
  await expectNoFatalErrorOrRestart(page);
  expectOnlyKnownRequests(gateway);
});

test('a switch asked before hls.js reports the starting quality reads the new quality once', async ({
  page,
  context,
}) => {
  // Found by this journey on 2026-10-07. hls.js reports the quality it started on with LEVEL_SWITCHED once that
  // quality's first fragment plays. A switch asked before then is under way when the report arrives, so the poller is
  // told the level hls.js is loading as well and keeps following it. Before that it stopped the target and searched for
  // it again when hls.js next asked. Asked here at the first buffered fragment, so the order is the same every run. On
  // a live stream the same order arises when ABR moves off the starting quality before its first fragment plays.
  const gateway = new LadderGateway();
  const target: RungName = '360p';
  const warnings = await openPage(page, context, gateway, target);
  await expect
    .poll(async () => (await probeState(page)).switchAskedAtMs, { message: 'the switch is asked' })
    .not.toBeNull();
  const askedAtMs = (await probeState(page)).switchAskedAtMs!;
  const switchedAtMs = await waitForSwitchTo(page, target, askedAtMs, 30_000);
  await page.waitForTimeout(QUIET_WATCH_MS);

  report('early switch', {
    to: target,
    switchMs: switchedAtMs - askedAtMs,
    targetReadsPerMinute: readRates(gateway, target, switchedAtMs, Date.now()),
    switches: (await probeState(page)).switches.map((s) => ({ uri: s.uri, afterAskMs: s.atMs - askedAtMs })),
    requestsSinceAsk: gateway.tally(askedAtMs),
    warnings,
  });
  expect(mostReadsOfOneSlot(gateway, target, askedAtMs), `${target} is found once and never started over`).toBe(1);
});

test('the playing quality stops publishing: the player fails over to a sibling and keeps playing', async ({
  page,
  context,
}) => {
  const gateway = new LadderGateway();
  const { warnings } = await openStream(page, context, gateway);
  expect(await playingUri(page), `the player starts on ${TOP}`).toBe(rungUri(TOP));

  const sibling: RungName = '480p';
  const stoppedAtMs = Date.now();
  gateway.stop(TOP);
  const switchedAtMs = await waitForSwitchTo(page, sibling, stoppedAtMs, FAILOVER_WAIT_MS);
  await expectPlaysOn(page, 'after the failover');
  const quietFromMs = switchedAtMs + 1_000;
  await page.waitForTimeout(QUIET_WATCH_MS);

  report('failover', {
    stopped: TOP,
    to: sibling,
    failoverMs: switchedAtMs - stoppedAtMs,
    siblingReadsPerMinute: readRates(gateway, sibling, quietFromMs, Date.now()),
    requestsSinceStop: gateway.tally(stoppedAtMs),
    warnings,
  });
  expect(await levelUris(page), `${TOP} is taken out of the ladder`).not.toContain(rungUri(TOP));
  expect(gateway.feedReads(TOP, quietFromMs), `${TOP} is no longer read`).toBe(0);
  for (const other of RUNGS.filter((candidate) => candidate.name !== TOP && candidate.name !== sibling)) {
    expect(gateway.feedReads(other.name), `${other.name} is never read`).toBe(0);
  }
  await expectNoFatalErrorOrRestart(page);
  expectOnlyKnownRequests(gateway);
});

/** A quality that cannot be switched to, and how the fake leaves it so. */
const UNUSABLE: { why: string; rung: RungName; leave: (gateway: LadderGateway, rung: RungName) => void }[] = [
  { why: 'finished', rung: '360p', leave: (gateway, rung) => gateway.finish(rung, 20_000) },
  { why: 'long stale', rung: '240p', leave: (gateway, rung) => gateway.stale(rung, 50_000) },
];

for (const { why, rung, leave } of UNUSABLE) {
  test(`a switch to a ${why} quality is refused and the video keeps playing`, async ({ page, context }) => {
    const gateway = new LadderGateway();
    leave(gateway, rung);
    const { warnings } = await openStream(page, context, gateway);
    expect(await playingUri(page), `the player starts on ${TOP}`).toBe(rungUri(TOP));

    const askedAtMs = Date.now();
    await switchTo(page, rungUri(rung));
    await expect
      .poll(() => levelUris(page), { message: `the ${why} ${rung} is taken out of the ladder`, timeout: 30_000 })
      .not.toContain(rungUri(rung));
    const refusedMs = Date.now() - askedAtMs;
    await expectPlaysOn(page, 'after the refusal');
    const quietFromMs = Date.now();
    await page.waitForTimeout(QUIET_WATCH_MS);

    report(`refused ${why}`, {
      quality: rung,
      refusedMs,
      playingReadsPerMinute: readRates(gateway, TOP, quietFromMs, Date.now()),
      requestsSinceAsk: gateway.tally(askedAtMs),
      requestsOnceSettled: gateway.tally(quietFromMs),
      warnings,
    });
    expect(await playingUri(page), `the player stays on ${TOP}`).toBe(rungUri(TOP));
    expect(gateway.count('segment', rung), `no ${rung} segment is fetched`).toBe(0);
    for (const other of RUNGS.filter((candidate) => candidate.name !== TOP)) {
      expect(gateway.feedReads(other.name, quietFromMs), `${other.name} is no longer read`).toBe(0);
    }
    await expectNoFatalErrorOrRestart(page);
    expectOnlyKnownRequests(gateway);
  });
}

test('every quality ends with ENDLIST: the ended overlay shows', async ({ page, context }) => {
  const gateway = new LadderGateway();
  const { warnings } = await openStream(page, context, gateway);

  const endedAtMs = Date.now();
  gateway.finishAll();
  await expect(page.getByRole('status').filter({ hasText: 'This broadcast has ended' })).toBeVisible({
    timeout: 60_000,
  });

  report('ended', { overlayMs: Date.now() - endedAtMs, requestsSinceEnd: gateway.tally(endedAtMs), warnings });
  expect(gateway.count('master'), 'nothing is read for the master feed').toBe(0);
  await expectNoFatalErrorOrRestart(page);
  expectOnlyKnownRequests(gateway);
});
