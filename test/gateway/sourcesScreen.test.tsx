// @vitest-environment jsdom
import { Topic } from '@ethersphere/bee-js';
import { createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AppContextProvider, useAppContext } from '../../src/app/AppProvider';
import { SOURCE_STORAGE_KEYS } from '../../src/app/sourceStorage';
import { parseRuntimeConfig, type RuntimeConfig } from '../../src/config/runtimeConfig';
import {
  ADDRESS_REFUSED,
  CONNECTED_BY_CONTENT,
  NODE_NOT_READY,
  UNREACHABLE_SENTENCES,
} from '../../src/features/gateway/checkSentences';
import { SourcesScreen } from '../../src/features/gateway/SourcesScreen';
import type { SwarmClient } from '../../src/swarm/client';
import { sharedWeeb3Runtime } from '../../src/swarm/providers/weeb-3/weeb3Runtime';
import { fakeWeeb3Package } from '../helpers/fakeWeeb3';
import {
  button,
  click,
  dialog,
  input,
  mount,
  press,
  queryButton,
  settle,
  type,
  waitFor,
  type Mounted,
} from '../helpers/dom';

/** The package the page's one weeb-3 runtime loads, which each weeb-3 case sets. */
const fakeWeeb3 = vi.hoisted(() => ({
  current: null as ReturnType<typeof import('../helpers/fakeWeeb3').fakeWeeb3Package> | null,
}));

vi.mock('../../src/swarm/providers/weeb-3/weeb3Module', () => ({
  loadWeeb3Package: () => fakeWeeb3.current!.load(),
}));

const EVENT = 'https://event.example.com';
const BACKUP = 'https://backup.example.com';
const THIRD = 'https://third.example.com';
const CHAT = {
  enabled: true,
  readUrl: 'https://chat-read.example.com',
  writeUrl: 'https://chat-write.example.com',
  gsocResourceId: '2'.repeat(64),
  gsocTopic: 'event-chat',
  feedOwner: '3'.repeat(40),
  pollIntervalMs: 1_000,
};

const GATEWAYS = [
  { id: 'event', kind: 'bee-http', label: 'Event gateway', url: EVENT },
  { id: 'backup', kind: 'bee-http', label: 'Backup gateway', url: BACKUP },
];

function config({ beeNodes, gateways = GATEWAYS, fallback, ...extra }: Record<string, unknown> = {}): RuntimeConfig {
  const result = parseRuntimeConfig({
    ...extra,
    catalog: { owner: '0x' + '1'.repeat(40), topic: 'event-streams' },
    providers: {
      gateways,
      default: 'event',
      ...(fallback === undefined ? {} : { fallback }),
      ...(beeNodes === undefined ? {} : { beeNodes }),
    },
  });
  if (!result.ok) {
    throw new Error(result.problem);
  }
  return result.config;
}

const realFetch = globalThis.fetch;
let mounted: Mounted | null = null;
let app: ReturnType<typeof useAppContext> | null = null;
let copied: string | null = null;
let asked: string[] = [];

function Probe() {
  app = useAppContext();
  return null;
}

const swarm = (): SwarmClient => app!.swarm;

function render(extra: Record<string, unknown> = {}) {
  mounted = mount(
    createElement(AppContextProvider, {
      config: config(extra),
      children: [createElement(SourcesScreen, { key: 'screen' }), createElement(Probe, { key: 'probe' })],
    }),
  );
}

async function open(extra: Record<string, unknown> = {}) {
  render(extra);
  await settle();
  click(button(/^Sources/));
  await settle();
}

/** The list item of one source on the screen. */
function row(name: string): HTMLElement {
  const found = [...document.querySelectorAll<HTMLElement>('[data-source-row]')].find((item) =>
    item.querySelector('.source-row-name')?.textContent?.includes(name),
  );
  if (!found) {
    throw new Error(`no source row for ${name}`);
  }
  return found;
}

function radio(name: string): HTMLInputElement {
  return row(name).querySelector('input[type="radio"]') as HTMLInputElement;
}

function section(label: string): HTMLElement {
  const found = document.querySelector<HTMLElement>(`[aria-label="${label}"]`);
  if (!found) {
    throw new Error(`nothing labelled ${label}`);
  }
  return found;
}

function select(label: string): HTMLSelectElement {
  const found = [...document.querySelectorAll('label')].find((candidate) => candidate.textContent === label);
  const control = found ? document.getElementById(found.htmlFor) : null;
  if (!(control instanceof HTMLSelectElement)) {
    throw new Error(`no select labelled ${label}`);
  }
  return control;
}

/** Picks an option the way a viewer does, through the setter React listens behind. */
function pick(control: HTMLSelectElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set;
  setter?.call(control, value);
  click(control);
  control.dispatchEvent(new Event('change', { bubbles: true }));
}

const saved = (key: string) => JSON.parse(localStorage.getItem(key) ?? 'null');

/** Opens "Add source" and picks a tile. */
function startAdding(tile: 'Gateway' | 'Bee node') {
  click(button('Add source'));
  click(button(new RegExp(`^${tile}`)));
}

beforeEach(() => {
  localStorage.clear();
  copied = null;
  asked = [];
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText: async (value: string) => void (copied = value) },
  });
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    asked.push(url);
    if (url.endsWith('/health')) {
      return Response.json({ status: 'ok' });
    }
    if (url.endsWith('/weeb-3/weeb_3_bg.wasm')) {
      return new Response(new Uint8Array(8), { headers: { 'content-length': '8' } });
    }
    return new Response('', { status: 404 });
  }) as typeof fetch;
});

afterEach(() => {
  mounted?.unmount();
  mounted = null;
  app = null;
  document.body.innerHTML = '';
  globalThis.fetch = realFetch;
});

describe('the Sources screen', () => {
  it('is a dialog titled Sources, with a close button, a Done button and no intro paragraph', async () => {
    await open();

    expect(dialog()?.querySelector('h2')?.textContent).toBe('Sources');
    expect(dialog()?.querySelector('.dialog-header + p')).toBeNull();

    click(button('Close sources'));
    expect(dialog()).toBeNull();
    click(button(/^Sources/));
    click(button('Done'));
    expect(dialog()).toBeNull();
  });

  it('shows little text until something is opened', async () => {
    await open({ chat: CHAT });

    // The control panel this replaced showed 1,109 characters here, measured with this config, and the
    // screen is to show at least 80 percent less.
    expect((dialog()?.textContent ?? '').length).toBeLessThanOrEqual(221);
  });

  it('lists every gateway the deployment offers, the one in use checked and tagged, no other tag', async () => {
    await open();

    expect(section('Gateways').querySelector('h3')?.textContent).toBe('Gateways');
    expect([...row('Event gateway').querySelectorAll('.source-tag')].map((tag) => tag.textContent)).toEqual(['In use']);
    expect(row('Backup gateway').querySelector('.source-tag')).toBeNull();
    expect(radio('Event gateway').checked).toBe(true);
    expect(row('Backup gateway').textContent).not.toContain('In use');
    expect(row('Backup gateway').textContent).toContain('backup.example.com');
    expect(queryButton('Actions for Event gateway')).toBeNull();
  });

  it("names every row's controls with that row's source, for a screen reader", async () => {
    await open();
    click(button('Details of Backup gateway'));

    expect(radio('Backup gateway').getAttribute('aria-label')).toBe('Backup gateway');
    expect(button('Use Backup gateway')).toBeDefined();
    expect(button(/^(Retest|Testing) Backup gateway$/)).toBeDefined();
    expect(button('Details of Backup gateway').getAttribute('aria-expanded')).toBe('true');
  });

  it('switches to another gateway and remembers it, with the event gateway behind it as the fallback', async () => {
    await open();
    click(radio('Backup gateway'));
    await settle();

    expect(app!.parts.player).toBe('backup');
    expect(saved(SOURCE_STORAGE_KEYS.routing)).toMatchObject({ mode: 'one', source: 'backup' });
    expect(row('Backup gateway').textContent).toContain('In use');
    expect(swarm().activity()[0].fallbackOrder).toEqual(['event']);
    expect(button(/^Sources/).textContent).toContain('Backup gateway');
  });

  describe('each source at a glance', () => {
    it('checks every source as the screen opens, and shows how long each took', async () => {
      await open();

      await waitFor(() => (row('Event gateway').querySelector('[data-health="ok"]') ? true : null));
      expect(row('Event gateway').querySelector('.source-status-words')?.textContent).toMatch(/^\d+ ms$/);
    });

    it('checks nothing while the screen is closed', async () => {
      render();
      await settle();
      asked = [];
      await settle();

      expect(asked).toEqual([]);
    });

    it('marks a source that does not answer as failing', async () => {
      globalThis.fetch = (async (input: RequestInfo | URL) => {
        if (String(input).startsWith(BACKUP)) {
          throw new TypeError('Failed to fetch');
        }
        return new Response('', { status: 404 });
      }) as typeof fetch;
      await open();

      await waitFor(() => (row('Backup gateway').querySelector('[data-health="failing"]') ? true : null));
      expect(row('Backup gateway').textContent).toContain('Not answering');
    });
  });

  describe("a source's details", () => {
    it('test the source on every part when opened, as badges and one line', async () => {
      await open();
      click(button('Details of Backup gateway'));
      await waitFor(() => (row('Backup gateway').querySelector('.source-badges') ? true : null));

      const badges = [...row('Backup gateway').querySelectorAll('.source-badge')].map((badge) => badge.textContent);
      expect(badges).toEqual([
        'Connection: passed',
        'Stream list: failed',
        'Video: not applicable',
        'Previews: not applicable',
        'Pictures: not applicable',
        'Chat: not applicable',
      ]);
      // One failure says itself in its badge and its fix's heading, so no status line repeats it.
      expect(row('Backup gateway').querySelector('.source-status-line')?.textContent).toBe('');
      expect(row('Backup gateway').querySelector('.source-fix-name')?.textContent).toBe('Stream list');
    });

    it('show the sentences only for a failure, behind How to fix', async () => {
      await open();
      click(button('Details of Backup gateway'));
      await waitFor(() => (row('Backup gateway').querySelector('.source-fix') ? true : null));

      const fix = row('Backup gateway').querySelector('details.source-fix') as HTMLDetailsElement;
      expect(fix.open).toBe(false);
      expect(fix.querySelector('summary')?.textContent).toBe('How to fix');
      expect(fix.textContent).toContain('This gateway answered that the stream list is not there.');
      expect(fix.textContent).not.toContain(CONNECTED_BY_CONTENT);
    });

    it('ask a gateway the deployment offers for no health, and a Bee node for its health and readiness', async () => {
      await open({ beeNodes: 'https' });
      click(button('Details of Backup gateway'));
      await waitFor(() => (row('Backup gateway').querySelector('.source-badges') ? true : null));
      expect(asked.filter((url) => url.startsWith(BACKUP) && url.endsWith('/health'))).toEqual([]);

      startAdding('Bee node');
      click(button('Check and add'));
      await waitFor(() => (app!.sources.length === 3 ? true : null));
      click(button('Details of Bee node'));
      await waitFor(() => (row('Bee node').querySelector('.source-badges') ? true : null));
      expect(asked).toContain('http://localhost:1633/health');
      expect(asked).toContain('http://localhost:1633/readiness');
    });

    it('retest on asking, and use the source from its Use button', async () => {
      await open();
      click(button('Details of Backup gateway'));
      await waitFor(() => (queryButton('Retest Backup gateway') ? true : null));
      const before = asked.length;
      click(button('Retest Backup gateway'));
      await waitFor(() => (queryButton('Retest Backup gateway') ? true : null));
      expect(asked.length).toBeGreaterThan(before);

      click(button('Use Backup gateway'));
      await settle();
      expect(app!.parts.player).toBe('backup');
      // In use is the row's tag, never a disabled button.
      expect(queryButton('Use Backup gateway')).toBeNull();
      expect(row('Backup gateway').querySelector('.source-tag.in-use')?.textContent).toBe('In use');
    });

    it('forget a Test the viewer stopped by closing the screen, so it can be run again', async () => {
      // Every read but the health check waits until it is stopped, so the Test is still running at close.
      globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
        if (String(input).endsWith('/health')) {
          return Response.json({ status: 'ok' });
        }
        return new Promise<Response>((_, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new DOMException('stopped', 'AbortError')));
        });
      }) as typeof fetch;
      await open();
      click(button('Details of Backup gateway'));
      expect(button('Testing Backup gateway').disabled).toBe(true);

      click(document.querySelector('.dialog-backdrop') as HTMLElement);
      await settle();
      expect(dialog()).toBeNull();
      click(button(/^Sources/));
      click(button('Details of Backup gateway'));

      expect(queryButton('Testing Backup gateway')).not.toBeNull();
      click(button('Close sources'));
    });
  });

  describe('adding a source', () => {
    it('offers a tile per type, and greys a gateway with its reason where the site allows only its own', async () => {
      await open();
      click(button('Add source'));

      expect(button(/^Gateway/).disabled).toBe(true);
      expect(button(/^Gateway/).textContent).toContain('Not allowed on this site');
      expect(button(/^Bee node/).disabled).toBe(false);
    });

    it("checks a node of the viewer's own before adding it, and says why one cannot be used", async () => {
      await open();
      startAdding('Bee node');
      type(input('Address'), 'http://example.com:1633');
      click(button('Check and add'));
      await settle();

      expect(dialog()?.textContent).toContain('Only a Bee node on this computer can be used here');
      expect(app!.sources).toHaveLength(2);

      type(input('Name'), 'Desk node');
      type(input('Address'), 'http://localhost:1633');
      click(button('Check and add'));
      await waitFor(() => (app!.parts.player !== 'event' ? true : null));

      expect(row('Desk node').textContent).toContain('localhost:1633');
      expect(radio('Desk node').checked).toBe(true);
      expect(saved(SOURCE_STORAGE_KEYS.sources)).toEqual([
        { id: 'added-1', type: 'bee-node', name: 'Desk node', url: 'http://localhost:1633' },
      ]);
    });

    it('takes a node on another machine at an https address where the deployment allows it', async () => {
      await open({ beeNodes: 'https' });
      startAdding('Bee node');
      expect(dialog()?.textContent).toContain('another machine');
      type(input('Address'), 'https://bee.example.com');
      click(button('Check and add'));

      await waitFor(() => (app!.sources.some((source) => source.url === 'https://bee.example.com') ? true : null));
    });

    it('refuses plain http to the internet even where other machines are allowed, and says what to type', async () => {
      await open({ beeNodes: 'https-and-local-http' });
      startAdding('Bee node');
      type(input('Address'), 'http://bee.example.com:1633');
      press(input('Address'), 'Enter');
      await settle();

      expect(dialog()?.textContent).toContain(ADDRESS_REFUSED.plainHttpInternet);
      expect(app!.sources).toHaveLength(2);
    });

    it("shows the exact cors-allowed-origins lines for this page's origin behind How to fix, for a node that refuses this site", async () => {
      globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
        if (init?.mode === 'no-cors') {
          return new Response(null);
        }
        throw new TypeError('Failed to fetch');
      }) as typeof fetch;
      await open();
      startAdding('Bee node');
      click(button('Check and add'));
      await waitFor(() => (dialog()?.textContent?.includes(UNREACHABLE_SENTENCES['cors-refused']) ? true : null));

      const fix = section('Add source').querySelector('details.source-fix');
      expect(fix?.querySelector('summary')?.textContent).toBe('How to fix');
      expect(fix?.textContent).toContain(`cors-allowed-origins: ["${window.location.origin}"]`);
      expect(fix?.textContent).toContain(`BEE_CORS_ALLOWED_ORIGINS=${window.location.origin}`);
      expect(fix?.textContent).toContain('Swarm Desktop');
      expect(app!.sources).toHaveLength(2);
    });

    it("says a node of the viewer's own is still starting rather than adding it", async () => {
      const answer = globalThis.fetch;
      globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) =>
        String(input).endsWith('/readiness')
          ? Promise.resolve(Response.json({ status: 'notReady' }, { status: 400 }))
          : answer(input, init)) as typeof fetch;
      await open();
      startAdding('Bee node');
      click(button('Check and add'));
      await waitFor(() => (dialog()?.textContent?.includes(NODE_NOT_READY.starting) ? true : null));

      expect(app!.sources).toHaveLength(2);
    });

    it('adds a gateway where the site allows https, tested on the way, and shows its test at once', async () => {
      await open({ beeNodes: 'https' });
      startAdding('Gateway');
      type(input('Name'), 'My gateway');
      type(input('Address'), 'gw.example.com');
      click(button('Check and add'));
      await waitFor(() => (app!.sources.length === 3 ? true : null));

      expect(app!.sources[2]).toMatchObject({ type: 'gateway', name: 'My gateway', url: 'https://gw.example.com' });
      expect(app!.parts.player).toBe('added-1');
      click(button('Details of My gateway'));
      expect(row('My gateway').querySelectorAll('.source-badge')).toHaveLength(6);
    });

    it('adds any number of each type, grouped by type', async () => {
      await open({ beeNodes: 'https' });
      for (const name of ['One', 'Two']) {
        startAdding('Bee node');
        type(input('Name'), name);
        click(button('Check and add'));
        await waitFor(() => (app!.sources.some((source) => source.name === name) ? true : null));
      }

      expect([...section('Bee nodes').querySelectorAll('.source-row-name')].map((name) => name.textContent)).toEqual([
        'One',
        'Two',
      ]);
    });

    it('turn Done to a secondary button while the add form is open, so one primary is in view', async () => {
      await open();
      const done = () => [...document.querySelectorAll<HTMLButtonElement>('.dialog-footer button')].at(-1)!;
      expect(done().classList.contains('primary')).toBe(true);

      startAdding('Bee node');
      expect(done().classList.contains('secondary')).toBe(true);

      click(button('Cancel'));
      expect(done().classList.contains('primary')).toBe(true);
    });

    it('lists a tile that can be picked first, with where such a source may be inside it', async () => {
      await open();
      click(button('Add source'));

      const tiles = [...section('Add source').querySelectorAll<HTMLButtonElement>('.add-source-tile')];
      expect(tiles.map((tile) => tile.disabled)).toEqual([false, true, true]);
      expect(tiles[0].textContent).toContain('On this computer, such as Swarm Desktop');
    });
  });

  describe('the node in this browser', () => {
    beforeEach(() => {
      fakeWeeb3.current = fakeWeeb3Package();
      Object.defineProperty(navigator, 'serviceWorker', { configurable: true, value: { controller: {} } });
    });

    afterEach(async () => {
      await sharedWeeb3Runtime().stop();
    });

    it('is not offered unless the deployment switches it on', async () => {
      await open();
      click(button('Add source'));

      expect(button(/^Node in this browser/).disabled).toBe(true);
      expect(button(/^Node in this browser/).textContent).toContain('Not offered on this site');
    });

    it('is added with no address, and its status line counts its peers up to the healthy 200, with a note until then', async () => {
      await open({ weeb3: { enabled: true } });
      click(button('Add source'));
      click(button(/^Node in this browser/));

      expect(document.querySelector('input[aria-label="Address"]')).toBeNull();
      click(button('Add'));
      await waitFor(() => (app!.sources.some((source) => source.type === 'weeb-3') ? true : null));

      expect(section('In this browser').textContent).toContain('Node in this browser');
      await waitFor(() => (row('Node in this browser').textContent?.includes('Starting') ? true : null));

      fakeWeeb3.current!.nodes[0].peers = 4;
      await waitFor(() => (row('Node in this browser').textContent?.includes('4 of 200 peers') ? true : null), 100);
      expect(row('Node in this browser').textContent).toContain('200 peers is the healthy target');

      fakeWeeb3.current!.nodes[0].peers = 200;
      await waitFor(() => (row('Node in this browser').textContent?.includes('200 of 200 peers') ? true : null), 100);
      expect(row('Node in this browser').textContent).not.toContain('healthy target');
    });

    it('cannot be the one source for everything: it is greyed with its reason and adding it leaves the source in use', async () => {
      await open({ weeb3: { enabled: true } });
      click(button('Add source'));
      click(button(/^Node in this browser/));
      click(button('Add'));
      await waitFor(() => (app!.sources.some((source) => source.type === 'weeb-3') ? true : null));

      expect(radio('Node in this browser').disabled).toBe(true);
      expect(radio('Node in this browser').checked).toBe(false);
      expect(row('Node in this browser').textContent).toContain(
        'Video only for now. Pick it for Video under Per part.',
      );
      expect(app!.parts.player).toBe('event');
    });

    it('is picked for the video per part, and greyed with its reason for every other part', async () => {
      await open({ weeb3: { enabled: true }, chat: CHAT });
      click(button('Add source'));
      click(button(/^Node in this browser/));
      click(button('Add'));
      await waitFor(() => (app!.sources.some((source) => source.type === 'weeb-3') ? true : null));
      const id = app!.sources.find((source) => source.type === 'weeb-3')!.id;
      click(document.querySelector('.sources-modes input:not(:checked)') as HTMLInputElement);
      await settle();

      const option = (label: string) => [...select(label).options].find((candidate) => candidate.value === id)!;
      expect(option('Video').disabled).toBe(false);
      for (const label of ['Stream list', 'Previews', 'Chat']) {
        expect(option(label).disabled).toBe(true);
        expect(option(label).textContent).toBe('Node in this browser (Video only for now)');
      }

      pick(select('Video'), id);
      await settle();
      expect(app!.parts).toEqual({ player: id, 'stream-list': 'event', previews: 'event', chat: 'chat-read' });
    });

    it('shows a saved node without starting it, since only the video or adding one runs it', async () => {
      localStorage.setItem(
        'swarm-sources',
        JSON.stringify([{ id: 'added-1', type: 'weeb-3', name: 'Node in this browser', url: '' }]),
      );
      await open({ weeb3: { enabled: true } });
      await settle();

      expect(row('Node in this browser').textContent).toContain('Not started');
      expect(sharedWeeb3Runtime().status().state).toBe('stopped');
    });

    it('runs the node it adds while the screen is open, and stops it on Done when the video does not use it', async () => {
      await open({ weeb3: { enabled: true } });
      click(button('Add source'));
      click(button(/^Node in this browser/));
      click(button('Add'));
      await waitFor(() => (fakeWeeb3.current!.nodes.length === 1 ? true : null));

      click(button('Done'));
      await waitFor(() => (sharedWeeb3Runtime().status().state === 'stopped' ? true : null));

      expect(fakeWeeb3.current!.nodes[0].freed).toBe(true);
    });

    it('is offered once, since a browser runs one node', async () => {
      await open({ weeb3: { enabled: true } });
      click(button('Add source'));
      click(button(/^Node in this browser/));
      click(button('Add'));
      await waitFor(() => (app!.sources.some((source) => source.type === 'weeb-3') ? true : null));
      click(button('Add source'));

      expect(button(/^Node in this browser/).disabled).toBe(true);
      expect(button(/^Node in this browser/).textContent).toContain('Already added');
    });

    it('is not tested like a gateway when its details open, and has no Retest', async () => {
      await open({ weeb3: { enabled: true } });
      click(button('Add source'));
      click(button(/^Node in this browser/));
      click(button('Add'));
      await waitFor(() => (app!.sources.some((source) => source.type === 'weeb-3') ? true : null));
      asked = [];

      click(button('Details of Node in this browser'));
      await settle();

      expect(queryButton('Retest Node in this browser')).toBeNull();
      expect(asked).toEqual([]);
    });
  });

  describe('a source the viewer added', () => {
    async function withDeskNode() {
      await open();
      startAdding('Bee node');
      type(input('Name'), 'Desk node');
      click(button('Check and add'));
      await waitFor(() => (app!.sources.length === 3 ? true : null));
    }

    it('is renamed from its details, and Escape leaves the name as it was', async () => {
      await withDeskNode();
      click(button('Details of Desk node'));
      click(button('Rename Desk node'));
      type(input('New name for Desk node'), 'Laptop');
      press(input('New name for Desk node'), 'Enter');
      await settle();

      expect(row('Laptop')).toBeDefined();
      expect(saved(SOURCE_STORAGE_KEYS.sources)[0].name).toBe('Laptop');

      click(button('Rename Laptop'));
      type(input('New name for Laptop'), 'Never');
      press(input('New name for Laptop'), 'Escape');
      await settle();
      expect(row('Laptop')).toBeDefined();
      expect(dialog()).not.toBeNull();
    });

    it('is removed from its details, the parts reading from it moving to the event gateway', async () => {
      await withDeskNode();
      expect(app!.parts.player).toBe('added-1');
      click(button('Details of Desk node'));
      click(button('Remove Desk node'));
      await settle();

      expect(app!.sources).toHaveLength(2);
      expect(app!.parts.player).toBe('event');
      expect(radio('Event gateway').checked).toBe(true);
    });
  });

  describe('per part', () => {
    async function perPart(extra: Record<string, unknown> = {}) {
      await open(extra);
      click(document.querySelector('.sources-modes input:not(:checked)') as HTMLInputElement);
      await settle();
    }

    it('shows four parts, each picking from the same sources, the chat from its service by default', async () => {
      await perPart({ chat: CHAT });

      expect(app!.routing.mode).toBe('per-part');
      for (const part of ['Video', 'Stream list', 'Previews']) {
        expect(select(part).value).toBe('event');
        expect([...select(part).options].map((option) => option.textContent)).toEqual([
          'Event gateway',
          'Backup gateway',
        ]);
      }
      expect(select('Chat').value).toBe('chat-read');
      expect(dialog()?.textContent).toContain("Messages go through the event's chat service");
    });

    it('keeps the sources reachable under a row with their count, Add source included', async () => {
      await perPart();
      expect(document.querySelector('[data-source-row]')).toBeNull();

      click(button(/^Sources\s*2$/));

      expect(row('Backup gateway').querySelector('input[type="radio"]')).toBeNull();
      expect(button('Details of Backup gateway')).toBeDefined();
      expect(button('Add source')).toBeDefined();
    });

    it('leaves the chat out on a site with no chat', async () => {
      await perPart();

      expect(document.querySelector('[data-part="chat"]')).toBeNull();
    });

    it('moves video and stream list together until unlinked, and then notes that live timing may slip', async () => {
      await perPart();
      pick(select('Video'), 'backup');
      await settle();
      expect(app!.parts).toMatchObject({ player: 'backup', 'stream-list': 'backup', previews: 'event' });
      expect(dialog()?.textContent).not.toContain('Timing may slip');

      click(button('Unlink video and stream list'));
      pick(select('Stream list'), 'event');
      await settle();

      expect(app!.parts).toMatchObject({ player: 'backup', 'stream-list': 'event' });
      expect(dialog()?.textContent).toContain('Video and stream list differ. Timing may slip.');
      expect(button('Link video and stream list').getAttribute('aria-pressed')).toBe('false');
    });

    it('reads each part from the source it picked', async () => {
      await perPart({ chat: CHAT });
      pick(select('Previews'), 'backup');
      pick(select('Chat'), 'backup');
      await settle();

      expect(
        swarm()
          .activity()
          .map(({ feature, primary }) => [feature, primary]),
      ).toEqual([
        ['player', 'event'],
        ['stream-list', 'event'],
        ['previews', 'backup'],
        ['chat', 'backup'],
      ]);
    });
  });

  describe('the fallback', () => {
    const three = { gateways: [...GATEWAYS, { id: 'third', kind: 'bee-http', label: 'Third gateway', url: THIRD }] };

    it("is one line of the deployment's order, the event gateway last", async () => {
      await open({ ...three, fallback: ['backup', 'third'] });
      click(radio('Third gateway'));
      await settle();

      expect(section('Fallback').textContent).toContain('Backup gateway, then Event gateway');
      click(button('Edit order'));
      expect(
        [...section('Fallback order').querySelectorAll('.fallback-item-name')].map((name) => name.textContent),
      ).toEqual(['Backup gateway', 'Third gateway', 'Event gateway']);
    });

    it('is reordered by the viewer, kept in the browser, with the event gateway pinned last', async () => {
      await open({ ...three, fallback: ['backup', 'third'] });
      click(button('Edit order'));
      expect(button('Done ordering').textContent).toBe('Done');
      click(button('Move Third gateway up'));
      await settle();

      expect(app!.fallbackOrder).toEqual(['third', 'backup', 'event']);
      expect(saved(SOURCE_STORAGE_KEYS.fallbackOrder)).toEqual(['third', 'backup', 'event']);
      expect(queryButton('Move Event gateway up')).toBeNull();
      expect(section('Fallback order').textContent).toContain('Always last');

      click(button('Move Backup gateway down'));
      await settle();
      expect(app!.fallbackOrder).toEqual(['third', 'backup', 'event']);
    });

    it('leaves the source in use out of the line, since it is never its own fallback', async () => {
      await open({ fallback: 'backup' });
      expect(section('Fallback').textContent).toBe('FallbackBackup gateway');

      click(radio('Backup gateway'));
      await settle();
      expect(section('Fallback').textContent).toBe('FallbackEvent gateway');
    });

    it('has no order to edit with one gateway behind the event gateway or none', async () => {
      await open();

      expect(queryButton('Edit order')).toBeNull();
    });

    it('names the source in use alone when nothing stands behind it', async () => {
      await open({ gateways: [GATEWAYS[0]] });

      expect(section('Fallback').textContent).toBe('FallbackEvent gateway only');
    });
  });

  it('copies diagnostics of the last test and the status, and no address but the tested one', async () => {
    await open();
    click(button('Details of Backup gateway'));
    await waitFor(() => (queryButton('Retest Backup gateway') ? true : null));
    click(button('Copy diagnostics'));
    await waitFor(() => copied);
    await settle();

    expect(copied).toContain(`Test of Backup gateway (${BACKUP})`);
    expect(copied).toContain('Status, the last minute');
    expect(copied).toContain('Reads from Event gateway.');
    expect(copied).not.toContain(EVENT);
    expect(dialog()?.textContent).toContain('Diagnostics copied');
  });

  const VIDEO_OWNER = 'a'.repeat(40);

  it('marks the header button while the fallback serves the video, with the screen closed', async () => {
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/health')) {
        return Response.json({ status: 'ok' });
      }
      return new Response('', { status: url.startsWith(BACKUP) && url.includes(VIDEO_OWNER) ? 502 : 404 });
    }) as typeof fetch;
    await open();
    click(radio('Backup gateway'));
    click(button('Done'));
    await settle();
    expect(button(/^Sources/).textContent).not.toContain('Using fallback');

    await swarm().reader('player').readFeedEntry(VIDEO_OWNER, Topic.fromString('a-rung'), 0);

    await waitFor(() => (button(/^Sources/).textContent?.includes('Using fallback') ? true : null), 150);
  });
});
