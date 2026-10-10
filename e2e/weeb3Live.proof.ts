import { Topic } from '@ethersphere/bee-js';
import { expect, test, type Page } from '@playwright/test';

import { serveConfig } from './journey';
import { PREVIEW_ORIGIN } from './recording';

/**
 * The real weeb-3 package in the built app, on the public Swarm network: the node in this browser is added, picked for
 * the video, reaches ready with peers, and plays a finished stream from its beginning. The stream list is answered
 * here with one entry for that stream, since the deployment's list is a placeholder. Timings are printed, never
 * asserted. Run it with `pnpm proof:weeb3`.
 *
 * WEEB3_PROOF_OWNER and WEEB3_PROOF_TOPIC name another stream.
 */

const STREAM = {
  owner: process.env.WEEB3_PROOF_OWNER ?? '2ac5d080dafd13b6ec1d25a4ca78102d45d2d9e4',
  topic: process.env.WEEB3_PROOF_TOPIC ?? 'b193bf5c-4df2-457f-8524-e370315f29de',
};

const CATALOG = { owner: '0x' + '1'.repeat(40), topic: 'weeb3-proof-stream-list' };
const CATALOG_TOPIC_HEX = Topic.fromString(CATALOG.topic).toString();

const feedIndexHeader = (index: number) => index.toString(16).padStart(16, '0');

/** The stream list as one entry for the proof's stream, at index 0, and nothing else at the gateway. */
async function answerStreamList(page: Page): Promise<void> {
  await page.route(`${PREVIEW_ORIGIN}/bee/**`, (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === `/bee/feeds/${CATALOG.owner.slice(2)}/${CATALOG_TOPIC_HEX}`) {
      const entry = { ...STREAM, title: 'weeb-3 proof stream', timestamp: 0, mediatype: 'video', state: 'vod' };
      return route.fulfill({
        status: 200,
        contentType: 'application/octet-stream',
        headers: { 'swarm-feed-index': feedIndexHeader(0), 'swarm-feed-index-next': feedIndexHeader(1) },
        body: JSON.stringify([entry]),
      });
    }
    return route.fulfill({ status: 404, body: '' });
  });
}

const since = (startedAtMs: number) => Math.round(Date.now() - startedAtMs);

test('the real weeb-3 node reaches ready with peers and plays a finished stream from its beginning', async ({
  page,
}) => {
  const report: Record<string, unknown> = { stream: STREAM };
  const segments: string[] = [];
  const messages: string[] = [];
  report.messages = messages;
  page.on('console', (message) => {
    if (message.type() === 'error' || message.type() === 'warning') {
      messages.push(message.text().slice(0, 300));
    }
  });
  page.on('pageerror', (error) => messages.push(`page error: ${error.message.slice(0, 300)}`));
  const weeb3Paths = new Set<string>();
  // Printed when the page closes, so a run that fails partway still says what it saw.
  page.on('close', () => console.log(`weeb-3 proof: ${JSON.stringify({ ...report, weeb3Paths: [...weeb3Paths] })}`));
  page.context().on('request', (request) => {
    const path = new URL(request.url()).pathname;
    if (path.startsWith('/weeb-3/')) {
      weeb3Paths.add(path.replace(/[0-9a-f]{40,}/g, '<hex>'));
    }
  });
  page.on('request', (request) => {
    const match = /\/weeb-3\/hls\/bytes\/([0-9a-f]{64})/.exec(request.url());
    if (match) {
      segments.push(match[1]);
    }
  });
  await serveConfig(page, { gatewayUrl: '/bee', catalog: CATALOG, weeb3: { enabled: true } });
  await answerStreamList(page);
  await page.goto('/');

  await page.getByRole('button', { name: /^Sources/ }).click();
  const screen = page.getByRole('dialog', { name: 'Sources' });
  await screen.getByRole('button', { name: 'Add source', exact: true }).click();
  await screen.getByRole('button', { name: /^Node in this browser/ }).click();
  const addedAtMs = Date.now();
  await screen.getByRole('button', { name: 'Add', exact: true }).click();
  await screen.locator('label.sources-mode', { hasText: 'Per part' }).click();
  await screen.getByLabel('Video', { exact: true }).selectOption({ label: 'Node in this browser' });
  await screen.locator('button.sources-disclosure').click();
  const status = screen.locator('[data-source-row]', { hasText: 'Node in this browser' }).getByRole('status');
  await expect(status, 'the node reaches ready with peers').toHaveText(/^\d+ of 200 peers$/, { timeout: 90_000 });
  report.readyMs = since(addedAtMs);
  report.readyLine = await status.textContent();
  await screen.getByRole('button', { name: 'Done', exact: true }).click();

  const openedAtMs = Date.now();
  await page.goto(`/#/watch/video/${STREAM.owner}/${STREAM.topic}`);
  const video = page.locator('.own-player video');
  await expect
    .poll(() => video.evaluate((element: HTMLVideoElement) => element.readyState >= 3 || element.currentTime > 0), {
      message: 'the stream shows a picture',
      timeout: 240_000,
    })
    .toBe(true);
  report.firstFrameMs = since(openedAtMs);

  // weeb-3's player reads its segments inside its worker, so a segment's reference is found by following its
  // own playlists from the stream's feed, as its player does.
  const reference =
    segments[0] ??
    (await page.evaluate(
      async ({ owner, topicHex }) => {
        let url = `/weeb-3/feeds/${owner}/${topicHex}?start=beginning`;
        for (let depth = 0; depth < 4; depth += 1) {
          const answer = await fetch(url);
          if (!answer.ok) {
            return null;
          }
          const lines = (await answer.text()).split('\n').filter((line) => line && !line.startsWith('#'));
          const next = lines[0];
          if (!next) {
            return null;
          }
          const segment = /\/bytes\/([0-9a-f]{64})/.exec(next);
          if (segment) {
            return segment[1];
          }
          url = new URL(next, new URL(url, location.href)).href;
        }
        return null;
      },
      { owner: STREAM.owner, topicHex: Topic.fromString(STREAM.topic).toString() },
    ));
  report.segmentReference = reference ?? 'none found';
  if (reference) {
    report.span = await page.evaluate(async (ref) => {
      const plain = new Uint8Array(await (await fetch(`/weeb-3/hls/bytes/${ref}`)).arrayBuffer());
      const spanned = new Uint8Array(await (await fetch(`/weeb-3/bytes/${ref}`)).arrayBuffer());
      const span = new DataView(spanned.buffer).getBigUint64(0, true);
      const rest = spanned.slice(8);
      return {
        reference: ref,
        hlsBytes: plain.length,
        bytesBytes: spanned.length,
        spanNamesTheLength: span === BigInt(plain.length),
        restIsTheSegment: rest.length === plain.length && rest.every((byte, at) => byte === plain[at]),
      };
    }, reference);
  }

  // Whether freeing the page's node ends the shared worker's: the video moves off weeb-3, which frees the node, and a
  // fresh handle on the same shared worker, never started, asks how many peers the worker still has.
  await page.getByRole('button', { name: /^Sources/ }).click();
  await screen.getByLabel('Video', { exact: true }).selectOption({ label: 'Event gateway' });
  await expect(status, 'the node is stopped once nothing holds it').toHaveText('Not started', { timeout: 10_000 });
  report.rowAfterFree = await status.textContent();
  await screen.getByRole('button', { name: 'Done', exact: true }).click();
  const peersAfterFree: Record<string, number | string> = {};
  for (const afterMs of [2_000, 15_000]) {
    await page.waitForTimeout(afterMs - (afterMs === 2_000 ? 0 : 2_000));
    peersAfterFree[`${afterMs} ms`] = await page.evaluate(async () => {
      const chunk = performance
        .getEntriesByType('resource')
        .map(({ name }) => name)
        .find((name) => /\/assets\/weeb_3-[^/]+\.js$/.test(name));
      if (!chunk) {
        return 'the package chunk was not loaded on this page';
      }
      const weeb3 = await import(/* @vite-ignore */ chunk);
      await weeb3.default({ module_or_path: '/weeb-3/weeb_3_bg.wasm' });
      const handle = new weeb3.Weeb3No103(undefined, '/');
      try {
        return await handle.connectionCount();
      } catch (error) {
        return `the shared worker did not answer: ${String(error).slice(0, 200)}`;
      } finally {
        handle.free();
      }
    });
  }
  report.peersAfterFree = peersAfterFree;
});
