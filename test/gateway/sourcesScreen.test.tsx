// @vitest-environment jsdom
import { Topic } from '@ethersphere/bee-js';
import { createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { AppContextProvider, useAppContext } from '../../src/app/AppProvider';
import { parseRuntimeConfig, type RuntimeConfig } from '../../src/config/runtimeConfig';
import {
  ADDRESS_REFUSED,
  CONNECTED_BY_CONTENT,
  NODE_NOT_READY,
  UNREACHABLE_SENTENCES,
} from '../../src/features/gateway/checkSentences';
import { ControlPanel } from '../../src/features/gateway/ControlPanel';
import type { SwarmClient } from '../../src/swarm/client';
import { button, click, dialog, input, mount, settle, text, type, waitFor, type Mounted } from '../helpers/dom';

const EVENT = 'https://event.example.com';
const BACKUP = 'https://backup.example.com';
const GATEWAY_STORAGE_KEY = 'swarm-gateway-url';
const CHAT = {
  enabled: true,
  readUrl: 'https://chat-read.example.com',
  writeUrl: 'https://chat-write.example.com',
  gsocResourceId: '2'.repeat(64),
  gsocTopic: 'event-chat',
  feedOwner: '3'.repeat(40),
  pollIntervalMs: 1_000,
};

function config({ beeNodes, ...extra }: Record<string, unknown> = {}): RuntimeConfig {
  const result = parseRuntimeConfig({
    ...extra,
    catalog: { owner: '0x' + '1'.repeat(40), topic: 'event-streams' },
    providers: {
      gateways: [
        { id: 'event', kind: 'bee-http', label: 'Event gateway', url: EVENT },
        { id: 'backup', kind: 'bee-http', label: 'Backup gateway', url: BACKUP },
      ],
      default: 'event',
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
let gatewayUrl = '';
let swarm: SwarmClient | null = null;
let copied: string | null = null;

function Probe() {
  ({ gatewayUrl, swarm } = useAppContext());
  return null;
}

async function open(extra: Record<string, unknown> = {}) {
  mounted = mount(
    createElement(AppContextProvider, {
      config: config(extra),
      children: [createElement(ControlPanel, { key: 'panel' }), createElement(Probe, { key: 'probe' })],
    }),
  );
  await settle();
  click(button(/^Gateway/));
}

/** The list item of one gateway in the panel. */
function row(name: string): HTMLElement {
  const found = [...document.querySelectorAll<HTMLElement>('[data-gateway-row]')].find((item) =>
    item.textContent?.includes(name),
  );
  if (!found) {
    throw new Error(`no gateway row for ${name}`);
  }
  return found;
}

function buttonIn(container: HTMLElement, name: string): HTMLButtonElement {
  const found = [...container.querySelectorAll('button')].find((candidate) => candidate.textContent?.trim() === name);
  if (!found) {
    throw new Error(`no ${name} button in ${container.textContent}`);
  }
  return found;
}

beforeEach(() => {
  localStorage.clear();
  copied = null;
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText: async (value: string) => void (copied = value) },
  });
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.endsWith('/health')) {
      return Response.json({ status: 'ok' });
    }
    return new Response('', { status: 404 });
  }) as typeof fetch;
});

afterEach(() => {
  mounted?.unmount();
  mounted = null;
  document.body.innerHTML = '';
  globalThis.fetch = realFetch;
});

describe('the control panel', () => {
  it('lists every gateway the deployment offers, the one in use and the one behind it', async () => {
    await open();

    expect(dialog()?.textContent).toContain('Where the video loads from');
    expect(row('Event gateway').textContent).toContain('In use');
    expect(row('Backup gateway').textContent).not.toContain('In use');
    expect(row('Your own node').textContent).toContain('Not in use');
  });

  it("names every row's buttons with that row's gateway, for a screen reader", async () => {
    await open();

    expect(button('Test Backup gateway')).toBe(buttonIn(row('Backup gateway'), 'Test'));
    expect(button('Use Backup gateway')).toBe(buttonIn(row('Backup gateway'), 'Use'));
    expect(button('Event gateway is in use').disabled).toBe(true);
    expect(button('Test your own node')).toBe(buttonIn(row('Your own node'), 'Test'));
  });

  it("switches to another gateway and remembers it, with the event gateway as that one's fallback", async () => {
    await open();
    click(buttonIn(row('Backup gateway'), 'Use'));
    await settle();

    expect(gatewayUrl).toBe(BACKUP);
    expect(localStorage.getItem(GATEWAY_STORAGE_KEY)).toBe(BACKUP);
    click(button(/^Gateway/));
    expect(row('Backup gateway').textContent).toContain('In use');
    expect(row('Event gateway').textContent).toContain('Fallback');
  });

  it("checks a node of the viewer's own before using it, and says why one cannot be used", async () => {
    await open();
    type(input('Address of your own Bee node'), 'http://example.com:1633');
    click(button('Check and use'));
    await settle();

    expect(text()).toContain('Only a Bee node on this computer can be used here');
    expect(gatewayUrl).toBe(EVENT);

    type(input('Address of your own Bee node'), 'http://localhost:1633');
    click(button('Check and use'));
    await waitFor(() => (gatewayUrl === 'http://localhost:1633' ? true : null));
    expect(localStorage.getItem(GATEWAY_STORAGE_KEY)).toBe('http://localhost:1633');
  });

  it('takes a node on another machine at an https address where the deployment allows it', async () => {
    await open({ beeNodes: 'https' });
    expect(row('Your own node').textContent).toContain('another machine');
    type(input('Address of your own Bee node'), 'https://bee.example.com');
    click(button('Check and use'));
    await waitFor(() => (gatewayUrl === 'https://bee.example.com' ? true : null));
  });

  it('refuses plain http to the internet even where other machines are allowed, and says what to type', async () => {
    await open({ beeNodes: 'https-and-local-http' });
    type(input('Address of your own Bee node'), 'http://bee.example.com:1633');
    click(button('Check and use'));
    await settle();

    expect(text()).toContain(ADDRESS_REFUSED.plainHttpInternet);
    expect(gatewayUrl).toBe(EVENT);
  });

  it("shows the exact cors-allowed-origins lines for this page's origin when a node answers and refuses this site", async () => {
    globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.mode === 'no-cors') {
        return new Response(null);
      }
      throw new TypeError('Failed to fetch');
    }) as typeof fetch;
    await open();
    click(button('Check and use'));
    await waitFor(() => (text().includes(UNREACHABLE_SENTENCES['cors-refused']) ? true : null));

    const help = row('Your own node').textContent ?? '';
    expect(help).toContain(`cors-allowed-origins: ["${window.location.origin}"]`);
    expect(help).toContain(`BEE_CORS_ALLOWED_ORIGINS=${window.location.origin}`);
    expect(help).toContain('Swarm Desktop');
    expect(gatewayUrl).toBe(EVENT);
  });

  it("says a node of the viewer's own is still starting rather than switching to it", async () => {
    const answer = globalThis.fetch;
    globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) =>
      String(input).endsWith('/readiness')
        ? Promise.resolve(Response.json({ status: 'notReady' }, { status: 400 }))
        : answer(input, init)) as typeof fetch;
    await open();
    click(button('Check and use'));
    await waitFor(() => (text().includes(NODE_NOT_READY.starting) ? true : null));

    expect(gatewayUrl).toBe(EVENT);
  });

  it('tests a gateway on every feature and shows each sentence', async () => {
    await open();
    click(buttonIn(row('Backup gateway'), 'Test'));
    await waitFor(() => (text().includes(CONNECTED_BY_CONTENT) ? true : null));

    const results = row('Backup gateway').textContent ?? '';
    expect(results).toContain('Connection');
    expect(results).toContain('This gateway answered that the stream list is not there.');
    expect(results).toContain('Not tested: the stream list has no stream to test with.');
  });

  it("asks a node of the viewer's own for its health, and a gateway the deployment offers for none", async () => {
    const asked: string[] = [];
    const answer = globalThis.fetch;
    globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
      asked.push(String(input));
      return answer(input, init);
    }) as typeof fetch;
    await open();
    click(buttonIn(row('Backup gateway'), 'Test'));
    await waitFor(() => (row('Backup gateway').textContent?.includes(CONNECTED_BY_CONTENT) ? true : null));
    expect(asked.filter((url) => url.endsWith('/health'))).toEqual([]);

    click(button('Test your own node'));
    await waitFor(() => (row('Your own node').textContent?.includes('The gateway answered in') ? true : null));
    expect(asked.filter((url) => url.endsWith('/health'))).toEqual(['http://localhost:1633/health']);
    expect(asked).toContain('http://localhost:1633/readiness');
  });

  it('forgets a Test the viewer stopped by closing the panel, so it can be run again', async () => {
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
    click(buttonIn(row('Backup gateway'), 'Test'));
    expect(row('Backup gateway').textContent).toContain('Testing...');

    click(document.querySelector('.dialog-backdrop') as HTMLElement);
    await settle();
    expect(dialog()).toBeNull();
    click(button(/^Gateway/));

    expect(row('Backup gateway').textContent).not.toContain('Testing');
    expect(buttonIn(row('Backup gateway'), 'Test').disabled).toBe(false);
  });

  it('copies a report of the last test and the status', async () => {
    await open();
    click(buttonIn(row('Backup gateway'), 'Test'));
    await waitFor(() => (text().includes(CONNECTED_BY_CONTENT) ? true : null));
    click(button('Copy report'));
    await waitFor(() => copied);
    await settle();

    expect(copied).toContain(`Test of Backup gateway (${BACKUP})`);
    expect(copied).toContain('Status, the last minute');
    expect(copied).not.toContain(EVENT);
    expect(text()).toContain('Report copied.');
  });

  it("says the chat itself reads from the event's chat address, and names the chat check for what it tests", async () => {
    await open({ chat: CHAT });
    click(buttonIn(row('Backup gateway'), 'Test'));
    await waitFor(() => (text().includes(CONNECTED_BY_CONTENT) ? true : null));

    expect(dialog()?.textContent).toContain("The chat itself reads from the event's chat address");
    expect(row('Backup gateway').textContent).toContain('Chat feed on this gateway: ');
  });

  const VIDEO_OWNER = 'a'.repeat(40);

  it('marks the header button while the fallback serves the video, with the panel closed', async () => {
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/health')) {
        return Response.json({ status: 'ok' });
      }
      return new Response('', { status: url.startsWith(BACKUP) && url.includes(VIDEO_OWNER) ? 502 : 404 });
    }) as typeof fetch;
    await open();
    click(buttonIn(row('Backup gateway'), 'Use'));
    await settle();
    expect(button(/^Gateway/).textContent).not.toContain('Using fallback');

    await swarm?.reader('player').readFeedEntry(VIDEO_OWNER, Topic.fromString('a-rung'), 0);

    await waitFor(() => (button(/^Gateway/).textContent?.includes('Using fallback') ? true : null), 150);
  });

  it('shows who answered each feature in the last minute', async () => {
    await open();

    const status = document.querySelector('[aria-label="Status"]')?.textContent ?? '';
    expect(status).toContain('Stream list');
    expect(status).toContain('Reads from Event gateway. No fallback.');
    expect(status).toContain('In the last minute, Event gateway: 1 not there yet.');
  });
});
