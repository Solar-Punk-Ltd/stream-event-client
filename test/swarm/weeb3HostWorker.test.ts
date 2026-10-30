import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  controlPageWithHostWorker,
  WEEB3_HOST_WORKER_DEADLINE_MS,
  WEEB3_HOST_WORKER_URL,
  type WorkerContainer,
} from '../../src/swarm/providers/weeb-3/weeb3HostWorker';

const ORIGIN = 'https://viewer.example.com';
const HOST = `${ORIGIN}${WEEB3_HOST_WORKER_URL}`;
const PACKAGE_WORKER = `${ORIGIN}/weeb-3/service.js`;

interface FakeContainer extends WorkerContainer {
  readonly registered: { url: string; options: RegistrationOptions | undefined }[];
  /** The worker that controls the page from now on, which the browser announces with `controllerchange`. */
  takeControl(scriptURL: string): void;
}

/**
 * A browser's service worker container. `register` answers once the worker is installed, and the worker claims the
 * page when it activates, as weeb-3's own does, unless the test says the claim comes later or registering fails.
 */
function fakeContainer(
  controllingScript: string | null,
  options: { claims?: 'at-once' | 'later'; refuses?: boolean } = {},
): FakeContainer {
  const listeners = new Set<() => void>();
  const container: FakeContainer = {
    controller: controllingScript === null ? null : ({ scriptURL: controllingScript } as ServiceWorker),
    registered: [],
    async register(url: string | URL, registration?: RegistrationOptions) {
      container.registered.push({ url: String(url), options: registration });
      if (options.refuses) {
        throw new DOMException('refused', 'SecurityError');
      }
      if ((options.claims ?? 'at-once') === 'at-once') {
        container.takeControl(new URL(String(url), ORIGIN).href);
      }
      return {} as ServiceWorkerRegistration;
    },
    addEventListener(type: string, listener: () => void) {
      if (type === 'controllerchange') listeners.add(listener);
    },
    removeEventListener(type: string, listener: () => void) {
      if (type === 'controllerchange') listeners.delete(listener);
    },
    takeControl(scriptURL: string) {
      container.controller = { scriptURL } as ServiceWorker;
      for (const listener of [...listeners]) listener();
    },
  } as FakeContainer;
  return container;
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("weeb-3's root worker", () => {
  it('registers for the whole site on a first visit and answers once it controls the page, with no reload', async () => {
    const container = fakeContainer(null);

    await expect(controlPageWithHostWorker(container, ORIGIN)).resolves.toBe(true);

    expect(container.registered).toEqual([
      { url: WEEB3_HOST_WORKER_URL, options: { scope: '/', updateViaCache: 'none' } },
    ]);
    expect(container.controller?.scriptURL).toBe(HOST);
  });

  it('leaves the registration alone on a later visit, when it already controls the page', async () => {
    const container = fakeContainer(HOST);

    await expect(controlPageWithHostWorker(container, ORIGIN)).resolves.toBe(true);

    expect(container.registered).toEqual([]);
  });

  it("takes over from weeb-3's own worker that an earlier version registered for the whole site", async () => {
    const container = fakeContainer(PACKAGE_WORKER, { claims: 'later' });

    const controlled = controlPageWithHostWorker(container, ORIGIN);
    await vi.advanceTimersByTimeAsync(0);
    expect(container.registered).toHaveLength(1);
    container.takeControl(HOST);

    await expect(controlled).resolves.toBe(true);
  });

  it('answers false when the browser refuses the worker, so the node starts and says itself what it lacks', async () => {
    const container = fakeContainer(null, { refuses: true });

    await expect(controlPageWithHostWorker(container, ORIGIN)).resolves.toBe(false);
  });

  it('gives up waiting for control at its deadline', async () => {
    const container = fakeContainer(null, { claims: 'later' });

    const controlled = controlPageWithHostWorker(container, ORIGIN);
    await vi.advanceTimersByTimeAsync(WEEB3_HOST_WORKER_DEADLINE_MS);

    await expect(controlled).resolves.toBe(false);
  });

  it('answers false where the browser has no service workers', async () => {
    await expect(controlPageWithHostWorker(undefined, ORIGIN)).resolves.toBe(false);
  });
});
