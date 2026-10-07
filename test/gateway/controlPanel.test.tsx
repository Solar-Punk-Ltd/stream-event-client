// @vitest-environment jsdom
import { createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { AppContextProvider, useAppContext } from '../../src/app/AppProvider';
import { parseRuntimeConfig, type RuntimeConfig } from '../../src/config/runtimeConfig';
import { ControlPanel } from '../../src/features/gateway/ControlPanel';
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

function config(extra: Record<string, unknown> = {}): RuntimeConfig {
  const result = parseRuntimeConfig({
    ...extra,
    catalog: { owner: '0x' + '1'.repeat(40), topic: 'event-streams' },
    providers: {
      gateways: [
        { id: 'event', kind: 'bee-http', label: 'Event gateway', url: EVENT },
        { id: 'backup', kind: 'bee-http', label: 'Backup gateway', url: BACKUP },
      ],
      default: 'event',
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
let copied: string | null = null;

function Probe() {
  gatewayUrl = useAppContext().gatewayUrl;
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

  it('tests a gateway on every feature and shows each sentence', async () => {
    await open();
    click(buttonIn(row('Backup gateway'), 'Test'));
    await waitFor(() => (text().includes('The gateway answered in') ? true : null));

    const results = row('Backup gateway').textContent ?? '';
    expect(results).toContain('Connection');
    expect(results).toContain('This gateway answered that the stream list is not there.');
    expect(results).toContain('Not tested: the stream list has no stream to test with.');
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
    await waitFor(() => (text().includes('The gateway answered in') ? true : null));
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
    await waitFor(() => (text().includes('The gateway answered in') ? true : null));

    expect(dialog()?.textContent).toContain("The chat itself reads from the event's chat address");
    expect(row('Backup gateway').textContent).toContain('Chat feed on this gateway: ');
  });

  it('shows who answered each feature in the last minute', async () => {
    await open();

    const status = document.querySelector('[aria-label="Status"]')?.textContent ?? '';
    expect(status).toContain('Stream list');
    expect(status).toContain('Reads from Event gateway. No fallback.');
    expect(status).toContain('In the last minute, Event gateway: 1 not there yet.');
  });
});
