// @vitest-environment jsdom
import { ChunkBuilder, Span } from '@ethersphere/bee-js';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { sharedWeeb3Runtime } from '../../src/swarm/providers/weeb-3/weeb3Runtime';
import { button, click, dialog, type Mounted, settle, text, waitFor } from '../helpers/dom';
import { connectPage, seen } from '../helpers/connectPage';

/** The package the page's one weeb-3 runtime loads, which each case sets. */
const fakeWeeb3 = vi.hoisted(() => ({
  current: null as ReturnType<typeof import('../helpers/fakeWeeb3').fakeWeeb3Package> | null,
}));

vi.mock('../../src/swarm/providers/weeb-3/weeb3Module', () => ({
  loadWeeb3Package: () => fakeWeeb3.current!.load(),
}));

const SPAN_LENGTH = 8;
const PAYLOAD = new Uint8Array([1, 2, 3]);

/** A content-addressed chunk as weeb-3 serves it, its span first, and the address it is checked against. */
function contentChunk(): { address: string; bytes: Uint8Array } {
  const chunk = new ChunkBuilder(BigInt(PAYLOAD.length));
  chunk.writer.buffer.set(PAYLOAD);
  const bytes = new Uint8Array(SPAN_LENGTH + PAYLOAD.length);
  bytes.set(Span.fromBigInt(BigInt(PAYLOAD.length)).toUint8Array(), 0);
  bytes.set(PAYLOAD, SPAN_LENGTH);
  return { address: chunk.hash().toHex(), bytes };
}

const SEGMENT = contentChunk();
const STREAM_OWNER = 'e'.repeat(40);
const LIST = JSON.stringify([
  {
    owner: STREAM_OWNER,
    topic: 'main-stage',
    title: 'Main stage',
    timestamp: 1,
    mediatype: 'video',
    state: 'vod',
    renditions: [
      { name: '360p', width: 640, height: 360, topic: 'main-stage-360p', bandwidth: 1, avgBandwidth: 1, index: 2 },
    ],
  },
]);
const PLAYLIST = `#EXTM3U\n#EXT-X-TARGETDURATION:2\n#EXTINF:2.0,\n${SEGMENT.address}\n#EXT-X-ENDLIST\n`;

const withSpan = (body: string) => {
  const text = new TextEncoder().encode(body);
  const bytes = new Uint8Array(SPAN_LENGTH + text.length);
  bytes.set(text, SPAN_LENGTH);
  return bytes;
};

/** What the node in this browser's routes answer: the segment as a chunk and bytes, and a feed entry as the list or the playlist. */
function answering(input: RequestInfo | URL): Response {
  const path = new URL(String(input), 'http://localhost').pathname;
  if (path.startsWith(`/weeb-3/chunks/${SEGMENT.address}`) || path.startsWith(`/weeb-3/bytes/${SEGMENT.address}`)) {
    return new Response(SEGMENT.bytes);
  }
  if (path.startsWith('/weeb-3/chunks/')) {
    return new Response(answeredEntries++ === 0 ? withSpan(PLAYLIST) : withSpan(LIST));
  }
  if (path.includes('/feeds/')) {
    return new Response(LIST);
  }
  return new Response(new Uint8Array(64));
}

let answeredEntries = 0;
const realFetch = globalThis.fetch;
let mounted: Mounted | null = null;

beforeAll(() => {
  globalThis.fetch = (async (input: RequestInfo | URL) => answering(input)) as typeof fetch;
  Object.defineProperty(navigator, 'serviceWorker', { configurable: true, value: { controller: {} } });
});

afterAll(() => {
  globalThis.fetch = realFetch;
});

beforeEach(async () => {
  answeredEntries = 0;
  localStorage.clear();
  fakeWeeb3.current = (await import('../helpers/fakeWeeb3')).fakeWeeb3Package();
});

afterEach(async () => {
  mounted?.unmount();
  mounted = null;
  await sharedWeeb3Runtime().stop();
  document.body.innerHTML = '';
});

async function openWeeb3() {
  mounted = connectPage();
  await settle();
  click(button('Connect'));
  click(button('Add source'));
  click(button(/^Weeb3/));
}

describe('adding the node in this browser', () => {
  it('starts the node as the view opens, shows its download and its peers, and runs its checks', async () => {
    await openWeeb3();

    expect(dialog()?.querySelector('h2')?.textContent).toBe('Add Weeb3');
    expect(text()).toContain('Downloading the node');
    const node = await waitFor(() => fakeWeeb3.current!.nodes[0]);
    node.peers = 7;
    await waitFor(() => (text().includes('7 of 200') ? true : null), 100);
    expect(text()).toContain('200 is the healthy target. Playback can start before that.');
    expect(button('Add Weeb3').disabled).toBe(true);

    node.peers = 25;
    await waitFor(() => (button('Add Weeb3').disabled ? null : true), 200);
    expect([...document.querySelectorAll('[data-check]')].map((line) => line.getAttribute('data-state'))).toEqual([
      'passed',
      'passed',
      'passed',
      'passed',
      'passed',
    ]);
  });

  it('adds it once every check passed, and keeps it running while Connect stays open', async () => {
    await openWeeb3();
    const node = await waitFor(() => fakeWeeb3.current!.nodes[0]);
    node.peers = 25;
    await waitFor(() => (button('Add Weeb3').disabled ? null : true), 200);
    click(button('Add Weeb3'));
    await settle();

    expect(seen.app!.sources.at(-1)).toMatchObject({ type: 'weeb-3', name: 'Weeb3' });
    expect(sharedWeeb3Runtime().status().state).toBe('ready');
    expect(text()).toContain('Weeb3 · 25 of 200 peers · in this tab');

    click(button('Close Connect'));
    await settle();
    await waitFor(() => (sharedWeeb3Runtime().status().state === 'stopped' ? true : null));
  });

  it('stops the node when the view goes away without adding it', async () => {
    await openWeeb3();
    await waitFor(() => fakeWeeb3.current!.nodes[0]);
    click(button('Back'));
    await settle();

    await waitFor(() => (sharedWeeb3Runtime().status().state === 'stopped' ? true : null));
    expect(seen.app!.sources.some((source) => source.type === 'weeb-3')).toBe(false);
  });

  it('asks before closing Connect stops the node it is adding, and keeps it on Keep adding', async () => {
    await openWeeb3();
    await waitFor(() => fakeWeeb3.current!.nodes[0]);

    click(button('Close Connect'));
    await settle();
    expect(dialog()).not.toBeNull();
    expect(text()).toContain('Closing stops the node in this tab. Weeb3 is not added yet.');
    expect(document.activeElement).toBe(button('Keep adding'));

    click(button('Keep adding'));
    await settle();
    expect(text()).not.toContain('Closing stops the node');
    expect(sharedWeeb3Runtime().status().state).not.toBe('stopped');

    click(button('Close Connect'));
    click(button('Stop and close'));
    await settle();
    expect(dialog()).toBeNull();
    await waitFor(() => (sharedWeeb3Runtime().status().state === 'stopped' ? true : null));
  });

  it('starts the node again and runs its checks once more on Test again, after it failed', async () => {
    fakeWeeb3.current = (await import('../helpers/fakeWeeb3')).fakeWeeb3Package({ initFails: true });
    await openWeeb3();
    await waitFor(() => (document.querySelector('.connect-warn') ? true : null), 200);
    expect(document.querySelector('.connect-warn')?.textContent).toContain('Test again to start it once more.');

    fakeWeeb3.current = (await import('../helpers/fakeWeeb3')).fakeWeeb3Package();
    click(button('Test again'));
    const node = await waitFor(() => fakeWeeb3.current!.nodes[0], 200);
    node.peers = 25;

    await waitFor(() => (button('Add Weeb3').disabled ? null : true), 200);
  });
});
