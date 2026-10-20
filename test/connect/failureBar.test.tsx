// @vitest-environment jsdom
import { act, createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AppContextProvider } from '../../src/app/AppProvider';
import { parseRuntimeConfig, type RuntimeConfig } from '../../src/config/runtimeConfig';
import { ConnectProvider, useConnect } from '../../src/features/connect/ConnectContext';
import { FailureBars } from '../../src/features/connect/FailureBars';
import { type FeatureFailure, SwarmClient } from '../../src/swarm/client';
import { button, click, mount, type Mounted, queryButton, settle, text } from '../helpers/dom';

function config(extra: Record<string, unknown> = {}): RuntimeConfig {
  const result = parseRuntimeConfig({
    ...extra,
    catalog: { owner: '0x' + '1'.repeat(40), topic: 'event-streams' },
    providers: {
      gateways: [{ id: 'event', kind: 'bee-http', label: 'Event gateway', url: 'https://event.example.com' }],
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
let connect: ReturnType<typeof useConnect> | null = null;
let failures: FeatureFailure[] = [];

function Probe() {
  connect = useConnect();
  return null;
}

async function start(extra: Record<string, unknown> = {}): Promise<void> {
  mounted = mount(
    createElement(AppContextProvider, {
      config: config(extra),
      children: createElement(ConnectProvider, null, createElement(FailureBars), createElement(Probe)),
    }),
  );
  await settle();
}

describe('the failure bar', () => {
  beforeEach(() => {
    failures = [];
    globalThis.fetch = (async () => new Response('', { status: 404 })) as typeof fetch;
    vi.spyOn(SwarmClient.prototype, 'failures').mockImplementation(() => failures);
  });

  afterEach(() => {
    mounted?.unmount();
    mounted = null;
    connect = null;
    vi.restoreAllMocks();
    globalThis.fetch = realFetch;
  });

  it('shows nothing while every part loads', async () => {
    await start();

    expect(queryButton('Choose another source')).toBeNull();
  });

  it('says which part cannot load from which source and why, and opens My Swarm to choose another', async () => {
    failures = [{ feature: 'player', provider: 'event', forMs: 12_000, cause: { kind: 'no-answer' } }];
    await start();

    expect(text()).toContain('Video cannot load from Event gateway.');
    expect(text()).toContain('No answer for more than 10 s.');
    expect(connect!.isOpen).toBe(false);
    click(button('Choose another source'));
    expect(connect!.isOpen).toBe(true);
  });

  it('says what fails and why with no button, where the deployment offers no choice of sources', async () => {
    failures = [{ feature: 'player', provider: 'event', forMs: 12_000, cause: { kind: 'no-answer' } }];
    await start({ experimental: false });

    expect(text()).toContain('Video cannot load from Event gateway.');
    expect(text()).toContain('No answer for more than 10 s.');
    expect(queryButton('Choose another source')).toBeNull();
  });

  it('gives each failing part a bar of its own', async () => {
    failures = [
      { feature: 'stream-list', provider: 'event', forMs: 15_000, cause: { kind: 'status', status: 503 } },
      { feature: 'chat', provider: 'event', forMs: 11_000, cause: { kind: 'rate-limited' } },
    ];
    await start();

    expect(text()).toContain('Stream list cannot load from Event gateway.');
    expect(text()).toContain('It answers with an error (HTTP 503).');
    expect(text()).toContain('Chat history cannot load from Event gateway.');
    expect(text()).toContain('It asks to be asked less often.');
    expect(document.querySelectorAll('[data-failing-part]')).toHaveLength(2);
  });

  it('announces only the title, and does not change the page while nothing it shows changed', async () => {
    let forMs = 12_000;
    vi.mocked(SwarmClient.prototype.failures).mockImplementation(() => [
      { feature: 'player', provider: 'event', forMs, cause: { kind: 'no-answer' } },
    ]);
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    try {
      await start();
      const bar = document.querySelector('[data-failing-part="player"]')!;
      expect([...document.querySelectorAll('[role="status"]')].map((part) => part.textContent)).toEqual([
        'Video cannot load from Event gateway.',
      ]);

      const changes: MutationRecord[] = [];
      const watcher = new MutationObserver((records) => changes.push(...records));
      watcher.observe(bar, { subtree: true, childList: true, characterData: true, attributes: true });
      for (let poll = 0; poll < 3; poll += 1) {
        forMs += 2_000;
        await act(async () => {
          await vi.advanceTimersByTimeAsync(2_000);
        });
      }
      watcher.disconnect();

      expect(changes).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });
});
