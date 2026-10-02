// @vitest-environment jsdom
import { createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AppContextProvider } from '../src/app/AppProvider';
import type { RuntimeConfig } from '../src/config/runtimeConfig';
import { DomainSelector } from '../src/features/gateway/DomainSelector';
import { manifestFetcher } from '../src/features/player/CustomManifestLoader';
import { button, click, mount, queryButton, settle, text, type Mounted } from './helpers/dom';

/**
 * The picker on a page the browser loaded from Swarm, which offers that browser's own node.
 *
 * jsdom cannot be put on a `bzz:` page, so the page's protocol is what this file decides instead.
 */

const page = vi.hoisted(() => ({ overBzz: true }));

vi.mock('@/features/player/browserNode', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/features/player/browserNode')>()),
  isServedOverBzz: () => page.overBzz,
}));

const EVENT_GATEWAY = 'https://event-gateway.example';
const CONFIG: RuntimeConfig = {
  gatewayUrl: EVENT_GATEWAY,
  catalog: { owner: '0x' + '1'.repeat(40), topic: 'event-streams' },
};

const realFetch = globalThis.fetch;
let mounted: Mounted | null = null;

async function showPicker(): Promise<void> {
  mounted = mount(createElement(AppContextProvider, { config: CONFIG }, createElement(DomainSelector)));
  await settle();
}

function remount(): Promise<void> {
  mounted?.unmount();
  return showPicker();
}

const headerLabel = () => document.querySelector('.gateway-button-current')?.textContent;
const openPicker = () => click(button(/^Bee node/));

beforeEach(() => {
  page.overBzz = true;
  localStorage.clear();
  // The catalog read the provider starts on mount. Nothing here is about the catalog.
  globalThis.fetch = async () => new Response('not found', { status: 404 });
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  mounted?.unmount();
  mounted = null;
  document.body.innerHTML = '';
  globalThis.fetch = realFetch;
  vi.restoreAllMocks();
});

describe('the picker on a page loaded over bzz', () => {
  it("starts on this browser's node, with the feeds on the event gateway", async () => {
    await showPicker();

    expect(headerLabel()).toBe('This browser');
    expect(manifestFetcher.segmentsFromBrowserNode).toBe(true);
    expect(manifestFetcher.beeUrl).toBe(EVENT_GATEWAY);
  });

  // The page cannot reach a node's HTTP port, so the address field could only ever fail its check.
  it("offers this browser's node in place of an address for one's own", async () => {
    await showPicker();
    openPicker();

    expect(text()).toContain("This browser's node");
    expect(text()).not.toContain('My own Bee node');
    expect(document.querySelector('input')).toBeNull();
    expect(button('In use').disabled).toBe(true);
  });

  it('moves the segments to the event gateway and back, and remembers the choice', async () => {
    await showPicker();
    openPicker();
    click(button('Use the event gateway'));

    expect(headerLabel()).toBe('Event gateway');
    expect(manifestFetcher.segmentsFromBrowserNode).toBe(false);
    expect(manifestFetcher.beeUrl).toBe(EVENT_GATEWAY);

    await remount();
    expect(headerLabel()).toBe('Event gateway');
    expect(manifestFetcher.segmentsFromBrowserNode).toBe(false);

    openPicker();
    click(button("Use this browser's node"));

    expect(headerLabel()).toBe('This browser');
    expect(manifestFetcher.segmentsFromBrowserNode).toBe(true);
  });

  /**
   * An own node saved on this page before it offered the browser's is one the page cannot reach. The
   * browser's node is on by default, and it reads its feeds from the event gateway.
   */
  it('reads feeds from the event gateway even with an own node saved', async () => {
    localStorage.setItem('swarm-gateway-url', 'http://localhost:1633');

    await showPicker();

    expect(manifestFetcher.segmentsFromBrowserNode).toBe(true);
    expect(manifestFetcher.beeUrl).toBe(EVENT_GATEWAY);
  });
});

describe('the picker on any other page', () => {
  beforeEach(() => {
    page.overBzz = false;
  });

  it("does not offer this browser's node, and loads segments from the gateway", async () => {
    await showPicker();
    openPicker();

    expect(text()).not.toContain("This browser's node");
    expect(text()).toContain('My own Bee node');
    expect(queryButton("Use this browser's node")).toBeNull();
    expect(manifestFetcher.segmentsFromBrowserNode).toBe(false);
  });

  // A choice made on a bzz page is not this page's to act on.
  it('ignores a browser node choice in storage', async () => {
    localStorage.setItem('swarm-segments-from-browser-node', 'on');

    await showPicker();

    expect(headerLabel()).toBe('Event gateway');
    expect(manifestFetcher.segmentsFromBrowserNode).toBe(false);
  });
});
