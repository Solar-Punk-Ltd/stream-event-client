// @vitest-environment jsdom
import { createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AppContextProvider, useAppContext } from '../src/app/AppProvider';
import { parseRuntimeConfig } from '../src/config/runtimeConfig';
import { sharedWeeb3Runtime } from '../src/swarm/providers/weeb-3/weeb3Runtime';
import { chooseSource, setMode, setPart } from '../src/swarm/routing';
import { fakeWeeb3Package } from './helpers/fakeWeeb3';
import { mount, settle, waitFor, type Mounted } from './helpers/dom';

/** The package the page's one weeb-3 runtime loads, made afresh for each case. */
const fakeWeeb3 = vi.hoisted(() => ({
  current: null as ReturnType<typeof import('./helpers/fakeWeeb3').fakeWeeb3Package> | null,
}));

vi.mock('../src/swarm/providers/weeb-3/weeb3Module', () => ({
  loadWeeb3Package: () => fakeWeeb3.current!.load(),
}));

type Context = ReturnType<typeof useAppContext>;

const realFetch = globalThis.fetch;
let mounted: Mounted | null = null;
let context: Context | null = null;

function Probe() {
  context = useAppContext();
  return null;
}

function start() {
  const result = parseRuntimeConfig({
    catalog: { owner: '0x' + '1'.repeat(40), topic: 'event-streams' },
    gatewayUrl: '/bee',
    weeb3: { enabled: true },
  });
  if (!result.ok) {
    throw new Error(result.problem);
  }
  mounted = mount(createElement(AppContextProvider, { config: result.config, children: createElement(Probe) }));
}

const app = (): Context => context!;
const state = () => sharedWeeb3Runtime().status().state;

async function addNode(): Promise<string> {
  const id = app().addSource({ type: 'weeb-3', name: '', url: '' });
  await settle();
  return id;
}

async function pickForVideo(id: string): Promise<void> {
  app().setRouting(setPart(setMode(app().routing, 'per-part'), 'player', id));
  await settle();
}

beforeEach(() => {
  localStorage.clear();
  fakeWeeb3.current = fakeWeeb3Package();
  globalThis.fetch = (async (input: RequestInfo | URL) =>
    String(input).endsWith('/weeb-3/weeb_3_bg.wasm')
      ? new Response(new Uint8Array(8), { headers: { 'content-length': '8' } })
      : new Response('', { status: 404 })) as typeof fetch;
});

afterEach(async () => {
  mounted?.unmount();
  mounted = null;
  context = null;
  await sharedWeeb3Runtime().stop();
  globalThis.fetch = realFetch;
});

describe('the node in this browser, over the life of the page', () => {
  it('stays stopped while it is only listed', async () => {
    start();
    await settle();
    await addNode();

    expect(state()).toBe('stopped');
  });

  it('starts once it is picked for the video, and stops and is freed when the video moves off it', async () => {
    start();
    await settle();
    await pickForVideo(await addNode());
    await waitFor(() => (fakeWeeb3.current!.nodes.length === 1 ? true : null));
    expect(state()).not.toBe('stopped');

    app().setRouting(setPart(app().routing, 'player', 'gateway'));
    await waitFor(() => (state() === 'stopped' ? true : null));

    expect(fakeWeeb3.current!.nodes[0].freed).toBe(true);
  });

  it('stops when the source it runs as is removed', async () => {
    start();
    await settle();
    const id = await addNode();
    await pickForVideo(id);
    await waitFor(() => (fakeWeeb3.current!.nodes.length === 1 ? true : null));

    app().removeSource(id);
    await waitFor(() => (state() === 'stopped' ? true : null));

    expect(fakeWeeb3.current!.nodes[0].freed).toBe(true);
  });

  it('keeps the node through a change that makes the client again without moving the video', async () => {
    start();
    await settle();
    await pickForVideo(await addNode());
    await waitFor(() => (fakeWeeb3.current!.nodes.length === 1 ? true : null));

    app().setRouting(setPart(app().routing, 'previews', 'gateway'));
    app().setRouting(chooseSource(app().routing, 'gateway'));
    await settle();
    await settle();

    expect(fakeWeeb3.current!.nodes).toHaveLength(1);
    expect(fakeWeeb3.current!.nodes[0].freed).toBe(false);
  });
});
