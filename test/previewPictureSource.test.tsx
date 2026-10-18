// @vitest-environment jsdom
/**
 * Measured on the deployed viewer on 2026-10-18: with the pictures shown from a gateway, switching
 * Previews to Weeb3 in My Swarm replaced every picture with the placeholder, and none came back in
 * two minutes, while Weeb3 chosen before the page loaded drew them all. The card was handed weeb-3's
 * `/weeb-3/bzz/` URL the moment the client changed, before the node had started and before its
 * service worker controlled the page, so the browser asked the site itself, which never serves a
 * picture there. The image failed, the card recorded the failure against the picture for good, and
 * the node becoming ready a few seconds later changed nothing.
 */
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { StreamPreview } from '../src/features/catalog/StreamPreview/StreamPreview';
import { MEDIA_TYPE_VIDEO, STREAM_STATUS_SCHEDULED } from '../src/features/catalog/stream';
import { SwarmClient } from '../src/swarm/client';
import { BeeHttpProvider } from '../src/swarm/providers/bee-http/beeHttpProvider';
import { Weeb3Provider, type Weeb3RuntimeView } from '../src/swarm/providers/weeb-3/weeb3Provider';
import type { Weeb3Node } from '../src/swarm/providers/weeb-3/weeb3Package';
import type { Weeb3Status } from '../src/swarm/providers/weeb-3/weeb3Runtime';

const THUMBNAIL = 'ab'.repeat(32);
const EVENT_GATEWAY = 'https://event-gateway.example.com';
const PUBLIC_GATEWAY = 'https://public-gateway.example.com';
const WEEB3_PICTURE = `/weeb-3/bzz/${THUMBNAIL}/`;
const PAGE_ORIGIN = 'http://viewer.example';

const context = vi.hoisted(() => ({ swarm: null as unknown }));

vi.mock('../src/app/AppProvider', () => ({ useAppContext: () => ({ swarm: context.swarm }) }));

/** The page's node, which the test moves from starting to ready as weeb-3's peer watch would. */
function nodeRuntime(
  initial: Weeb3Status,
): Weeb3RuntimeView & { status: () => Weeb3Status; set(next: Weeb3Status): void } {
  let status = initial;
  const node = {} as Weeb3Node;
  return {
    status: () => status,
    set: (next) => {
      status = next;
    },
    acquire: async () => node,
    release: () => undefined,
    whenReady: () => new Promise<Weeb3Node>(() => undefined),
    restart: () => undefined,
  };
}

/** A client whose previews read from the given provider, every other part from the event gateway. */
function previewsFrom(provider: BeeHttpProvider | Weeb3Provider): SwarmClient {
  return new SwarmClient({
    chosen: { id: 'gateway', provider: new BeeHttpProvider({ baseUrl: EVENT_GATEWAY }) },
    routes: { previews: { id: 'previews', provider } },
  });
}

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.useFakeTimers();
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.useRealTimers();
});

/** A scheduled card, which never probes, so its picture is the only thing it can show. */
function showCard() {
  act(() => {
    root.render(
      createElement(
        MemoryRouter,
        null,
        createElement(StreamPreview, {
          variant: 'fill',
          owner: '0'.repeat(40),
          topic: 'stream-a',
          state: STREAM_STATUS_SCHEDULED,
          mediatype: MEDIA_TYPE_VIDEO,
          title: 'Stream A',
          thumbnail: THUMBNAIL,
        }),
      ),
    );
  });
}

const picture = () => container.querySelector('img');
const spinning = () => container.querySelector('.stream-thumbnail-loading') !== null;

/**
 * What the browser does with the card's picture: a `/weeb-3/` URL asked while the node is not ready
 * reaches the site rather than weeb-3's service worker, and fails. Anything else loads.
 */
function browserLoads(runtime?: { status: () => Weeb3Status }) {
  const img = picture();
  if (img === null) {
    return;
  }
  const src = img.getAttribute('src') ?? '';
  const failsOnSite = src.startsWith('/weeb-3/') && runtime?.status().state !== 'ready';
  act(() => {
    img.dispatchEvent(new Event(failsOnSite ? 'error' : 'load'));
  });
}

async function wait(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

describe('a stream card after Previews is switched to Weeb3', () => {
  it('waits with a loading indicator while the node starts, then draws the picture from weeb-3', async () => {
    const runtime = nodeRuntime({ state: 'stopped', peers: 0 });
    context.swarm = previewsFrom(new BeeHttpProvider({ baseUrl: EVENT_GATEWAY }));
    showCard();
    browserLoads();
    expect(picture()?.getAttribute('src')).toBe(`${EVENT_GATEWAY}/bzz/${THUMBNAIL}/`);

    context.swarm = previewsFrom(new Weeb3Provider({ runtime, pageOrigin: PAGE_ORIGIN }));
    showCard();
    browserLoads(runtime);
    runtime.set({ state: 'starting', peers: 0 });
    await wait(2_000);
    browserLoads(runtime);

    expect(picture(), 'no picture is asked of the site while the node starts').toBeNull();
    expect(spinning()).toBe(true);

    runtime.set({ state: 'ready', peers: 3 });
    await wait(1_000);
    browserLoads(runtime);

    expect(picture()?.getAttribute('src')).toBe(WEEB3_PICTURE);
    expect(spinning()).toBe(false);
  });
});

describe('a stream card after Previews is switched to a gateway', () => {
  it('draws the picture from the new gateway', () => {
    context.swarm = previewsFrom(new BeeHttpProvider({ baseUrl: EVENT_GATEWAY }));
    showCard();
    browserLoads();

    context.swarm = previewsFrom(new BeeHttpProvider({ baseUrl: PUBLIC_GATEWAY }));
    showCard();
    browserLoads();

    expect(picture()?.getAttribute('src')).toBe(`${PUBLIC_GATEWAY}/bzz/${THUMBNAIL}/`);
  });

  it('draws it even when the picture failed from the source before, which is a failure of that source', () => {
    context.swarm = previewsFrom(new BeeHttpProvider({ baseUrl: EVENT_GATEWAY }));
    showCard();
    act(() => {
      picture()!.dispatchEvent(new Event('error'));
    });
    expect(picture()).toBeNull();

    context.swarm = previewsFrom(new BeeHttpProvider({ baseUrl: PUBLIC_GATEWAY }));
    showCard();

    expect(picture()?.getAttribute('src')).toBe(`${PUBLIC_GATEWAY}/bzz/${THUMBNAIL}/`);
  });
});
