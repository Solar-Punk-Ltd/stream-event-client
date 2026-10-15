// @vitest-environment jsdom
import { act, createElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { StreamBrowser } from '../src/features/catalog/StreamBrowser/StreamBrowser';
import type { Source } from '../src/swarm/sources';
import { mount, type Mounted } from './helpers/dom';

const app = vi.hoisted(() => ({ source: null as Source | null }));

vi.mock('../src/app/AppProvider', () => ({
  useAppContext: () => ({
    streamList: [],
    isStreamListFromCurrentGateway: true,
    themeContent: { heroTitle: 'Streams', heroSubtitle: '', footer: {} },
    sources: app.source ? [app.source] : [],
    parts: { player: app.source?.id, 'stream-list': app.source?.id, previews: app.source?.id, chat: app.source?.id },
    fetchAppState: async () => {
      throw new Error('the stream list could not be read');
    },
    setNewStreamList: () => undefined,
  }),
}));
vi.mock('../src/app/layout/Footer/Footer', () => ({ Footer: () => null }));
vi.mock('../src/features/catalog/StreamList/StreamList', () => ({ StreamList: () => null }));

let mounted: Mounted | null = null;

afterEach(() => {
  mounted?.unmount();
  mounted = null;
  document.body.innerHTML = '';
});

async function alertFor(source: Source): Promise<string> {
  app.source = source;
  mounted = mount(createElement(StreamBrowser));
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 50));
  });
  return document.querySelector('[role="alert"]')?.textContent ?? '';
}

describe('the browse page when the stream list cannot be read', () => {
  it('names Weeb3, the node in this browser, rather than a gateway it is not', async () => {
    const words = await alertFor({ id: 'added-weeb3', type: 'weeb-3', name: 'Weeb3', url: '', offered: false });

    expect(words).toContain('Weeb3');
    expect(words).not.toContain('gateway');
  });

  it('still says a gateway could not be reached when the list is read from one', async () => {
    const words = await alertFor({
      id: 'added-gateway',
      type: 'gateway',
      name: 'A gateway',
      url: 'https://gateway.example.org',
      offered: false,
    });

    expect(words).toBe('Could not reach this gateway. Check the address, or pick another one.');
  });
});
