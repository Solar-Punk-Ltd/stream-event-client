// @vitest-environment jsdom
import { Topic } from '@ethersphere/bee-js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  FREEDOM_CONNECT_LINE,
  FREEDOM_CONNECTED_LINE,
  FREEDOM_DECLINED_LINE,
  FREEDOM_PARTS_NOTE,
} from '../../src/features/connect/connectWords';
import { button, click, dialog, type Mounted, queryButton, settle, text, waitFor } from '../helpers/dom';
import { chatConfig, connectPage, seen } from '../helpers/connectPage';
import { type FakeFreedom, fakeFreedom, type FakeFreedomOptions } from '../helpers/fakeFreedom';

const CATALOG_OWNER = '1'.repeat(40);
const CATALOG_TOPIC = Topic.fromString('event-streams').toHex();
const LIST = JSON.stringify([
  { owner: 'e'.repeat(40), topic: 'main-stage', title: 'Main stage', timestamp: 1, mediatype: 'video', state: 'vod' },
]);
const FREEDOM_TILE = /^This browser's Swarm node/;

const realFetch = globalThis.fetch;
let mounted: Mounted | null = null;
let swarm: FakeFreedom | null = null;

/** The page as Freedom opens it, with its `window.swarm` over a node that holds this event's stream list. */
function inFreedom(options: FakeFreedomOptions = {}): FakeFreedom {
  swarm = fakeFreedom({ feeds: { [`${CATALOG_OWNER}/${CATALOG_TOPIC}`]: [new TextEncoder().encode(LIST)] } }, options);
  Object.defineProperty(window, 'swarm', { configurable: true, value: swarm });
  return swarm;
}

async function openAddSource(config = chatConfig()) {
  mounted = connectPage({ config });
  await settle();
  click(button('My Swarm'));
  click(button('Add source'));
  await settle();
}

const tileNames = () => [...(dialog()?.querySelectorAll('.connect-tile b') ?? [])].map((name) => name.textContent);

async function addFreedom() {
  await openAddSource();
  click(button(FREEDOM_TILE));
  await waitFor(() => (queryButton('Add node')?.disabled === false ? true : null));
  click(button('Add node'));
  await settle();
}

beforeEach(() => {
  localStorage.clear();
  globalThis.fetch = (async () => new Response(LIST)) as typeof fetch;
});

afterEach(() => {
  mounted?.unmount();
  mounted = null;
  swarm = null;
  Reflect.deleteProperty(window, 'swarm');
  globalThis.fetch = realFetch;
  document.body.innerHTML = '';
});

describe('Add source, outside and inside the Freedom browser', () => {
  it('offers the three tiles it always did outside Freedom', async () => {
    await openAddSource();

    expect(tileNames()).toEqual(['Gateway', 'My Bee node', 'Weeb3']);
  });

  it("offers this browser's Swarm node as a fourth tile in Freedom", async () => {
    inFreedom();
    await openAddSource();

    expect(tileNames()).toEqual(['Gateway', 'My Bee node', 'Weeb3', "This browser's Swarm node"]);
    expect(button(FREEDOM_TILE).textContent).toContain('The node Freedom runs for you');
  });

  it("offers no sources at all with the experimental setting off, Freedom's among them", async () => {
    inFreedom();
    mounted = connectPage({ config: chatConfig({ experimental: false }) });
    await settle();
    click(button('My Swarm'));
    await settle();

    expect(queryButton('Add source')).toBeNull();
    expect(text()).not.toContain("This browser's Swarm node");
  });
});

describe("adding this browser's Swarm node", () => {
  it('runs its checks as the view opens, through window.swarm, and adds it once they pass', async () => {
    const freedom = inFreedom();
    await openAddSource();
    click(button(FREEDOM_TILE));

    expect(dialog()?.querySelector('h2')?.textContent).toBe("Add this browser's Swarm node");
    await waitFor(() => (queryButton('Add node')?.disabled === false ? true : null));
    const checks = [...(dialog()?.querySelectorAll('.connect-checks li') ?? [])];
    expect(checks.map((check) => [check.getAttribute('data-check'), check.getAttribute('data-state')])).toEqual([
      ['in-freedom', 'passed'],
      ['node', 'passed'],
      ['feed', 'passed'],
    ]);
    expect(checks.map((check) => check.querySelector('span:nth-child(2)')?.textContent)).toEqual([
      'Open in Freedom',
      'Its Swarm node answers',
      "Reads this event's stream list",
    ]);
    expect(freedom.calls.map(({ method }) => method)).toContain('swarm_readFeedEntry');

    click(button('Add node'));
    await settle();

    expect(seen.app!.sources.at(-1)).toMatchObject({ type: 'freedom', name: "This browser's Swarm node", url: '' });
    expect(JSON.parse(localStorage.getItem('swarm-sources') ?? '[]')).toEqual([
      { id: 'added-1', type: 'freedom', name: "This browser's Swarm node", url: '' },
    ]);
  });

  it('says what to do when Freedom does not let pages use its node, and adds nothing', async () => {
    inFreedom({ behaviour: 'switched-off' });
    await openAddSource();
    click(button(FREEDOM_TILE));
    await waitFor(() => (queryButton('Test again') ? true : null));

    expect(text()).toContain('Not added. Freedom does not let pages use its Swarm node.');
    expect(text()).toContain('Turn on Enable Identity & Wallet in Settings, Advanced, then test again.');
    expect(button('Add node').disabled).toBe(true);
  });

  it('is offered once: its tile says Already added after', async () => {
    inFreedom();
    await addFreedom();
    click(button('Add source'));

    expect(button(FREEDOM_TILE).disabled).toBe(true);
    expect(button(FREEDOM_TILE).textContent).toContain('Already added');
  });

  it('shows in the list as Freedom, in this browser, with no address', async () => {
    inFreedom();
    await addFreedom();

    const row = dialog()?.querySelector('[data-source-row="added-1"]');
    expect(row?.querySelector('.connect-row-meta')?.textContent).toMatch(/^Freedom · in this browser/);
  });

  it('is offered under Use for for the video, the stream list and the previews, and not for the chat history', async () => {
    inFreedom();
    await addFreedom();
    click(button('Per feature'));
    await settle();

    const offered = (label: string) => {
      const select = [...(dialog()?.querySelectorAll('.connect-part') ?? [])]
        .find((part) => part.querySelector('label')?.textContent === label)
        ?.querySelector('select');
      return [...(select?.options ?? [])].map((option) => option.textContent);
    };
    for (const part of ['Video', 'Stream list', 'Previews']) {
      expect(offered(part)).toContain("This browser's Swarm node");
    }
    expect(offered('Chat history')).not.toContain("This browser's Swarm node");
    expect(text()).toContain(FREEDOM_PARTS_NOTE);
  });
});

describe('Connect this site', () => {
  it('says what connecting does and asks Freedom only when the viewer clicks, never as the page loads', async () => {
    const freedom = inFreedom();
    await openAddSource();
    click(button(FREEDOM_TILE));
    await waitFor(() => (text().includes(FREEDOM_CONNECT_LINE) ? true : null));

    expect(freedom.calls.map(({ method }) => method)).not.toContain('swarm_requestAccess');

    click(button('Connect this site'));
    await waitFor(() => (text().includes(FREEDOM_CONNECTED_LINE) ? true : null));

    expect(freedom.calls.filter(({ method }) => method === 'swarm_requestAccess')).toHaveLength(1);
    expect(queryButton('Connect this site')).toBeNull();
  });

  it('says a site Freedom already counts as connected is, with nothing to click', async () => {
    inFreedom({ connected: true });
    await addFreedom();
    click(button("Settings of This browser's Swarm node"));

    await waitFor(() => (text().includes(FREEDOM_CONNECTED_LINE) ? true : null));
    expect(queryButton('Connect this site')).toBeNull();
  });

  it('says so when the viewer declines, and does not ask again until the page is loaded again', async () => {
    const freedom = inFreedom({ declines: true });
    await addFreedom();
    click(button("Settings of This browser's Swarm node"));
    await waitFor(() => (queryButton('Connect this site') ? true : null));

    click(button('Connect this site'));
    await waitFor(() => (text().includes(FREEDOM_DECLINED_LINE) ? true : null));
    click(button('Back'));
    click(button("Settings of This browser's Swarm node"));
    await settle();

    expect(text()).toContain(FREEDOM_DECLINED_LINE);
    expect(queryButton('Connect this site')).toBeNull();
    expect(freedom.calls.filter(({ method }) => method === 'swarm_requestAccess')).toHaveLength(1);
  });
});
