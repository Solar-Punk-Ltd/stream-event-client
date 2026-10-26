import type { Page } from '@playwright/test';

import type { LadderGateway } from './ladderGateway';
import { PREVIEW_ORIGIN } from './recording';

/** Where the page's fake `window.swarm` hands each call, answered by the journey's route before it leaves the page. */
const FREEDOM_CALLS = '/__fake-freedom-swarm';

interface FakeFreedomPage {
  /** Every method the page called, in order. */
  readonly methods: string[];
}

interface FakeFreedomOptions {
  /** Whether Freedom counts the site as connected already. */
  readonly connected?: boolean;
}

/**
 * The page as the Freedom browser opens it: a `window.swarm` in the top frame before the page's own scripts run, as
 * Freedom injects it, whose calls are answered by the fake gateway's {@link LadderGateway.freedomAnswer} as Freedom's
 * node would answer them. Connecting the site needs no prompt here, and is remembered for the page's life.
 *
 * Freedom's `bzz://` scheme cannot be faked: Chromium refuses a `fetch` and an image of an unknown scheme before
 * Playwright sees the request, so nothing here loads a segment or a picture through it.
 */
export async function openInFakeFreedom(
  page: Page,
  gateway: LadderGateway,
  options: FakeFreedomOptions = {},
): Promise<FakeFreedomPage> {
  const methods: string[] = [];
  let connected = options.connected ?? false;
  await page.route(`${PREVIEW_ORIGIN}${FREEDOM_CALLS}`, async (route) => {
    const { method, params } = route.request().postDataJSON() as { method: string; params: Record<string, unknown> };
    methods.push(method);
    let answer: { result?: unknown; error?: unknown };
    if (method === 'swarm_getCapabilities') {
      answer = { result: { specVersion: '1.0', canPublish: false, reason: connected ? null : 'not-connected' } };
    } else if (method === 'swarm_requestAccess') {
      connected = true;
      answer = { result: { connected: true, origin: PREVIEW_ORIGIN, capabilities: ['publish'] } };
    } else {
      answer = gateway.freedomAnswer(method, params);
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(answer) });
  });
  await page.addInitScript((path) => {
    Object.defineProperty(window, 'swarm', {
      value: {
        isFreedomBrowser: true,
        async request({ method, params }: { method: string; params?: Record<string, unknown> }) {
          const response = await fetch(path, {
            method: 'POST',
            body: JSON.stringify({ method, params: params ?? {} }),
          });
          const { result, error } = (await response.json()) as { result?: unknown; error?: { message: string } };
          if (error) {
            throw Object.assign(new Error(error.message), error);
          }
          return result;
        },
      },
    });
  }, FREEDOM_CALLS);
  return { methods };
}
