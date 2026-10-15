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
  it.each<Source>([
    { id: 'added-weeb3', type: 'weeb-3', name: 'Weeb3', url: '', offered: false },
    { id: 'added-node', type: 'bee-node', name: 'My Bee node', url: 'http://localhost:1633', offered: false },
    { id: 'event', type: 'gateway', name: 'Event gateway', url: 'https://gateway.example.org', offered: true },
  ])('names the source it reads from, $name, as the failure bars do', async (source) => {
    const words = await alertFor(source);

    expect(words).toBe(
      `Stream list cannot load from ${source.name}. Open My Swarm to check it, or pick another source.`,
    );
  });
});
