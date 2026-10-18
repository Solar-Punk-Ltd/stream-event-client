// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router';
import { ErrorDetails } from 'hls.js';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { StreamPreview } from '../src/features/catalog/StreamPreview/StreamPreview';
import { MEDIA_TYPE_VIDEO, STREAM_STATUS_VOD } from '../src/features/catalog/stream';
import { ManifestFetcher } from '../src/features/player/ManifestManagement';
import { segmentLoadFailure } from '../src/features/player/segmentLoads';
import type { UrlLoadOutcome } from '../src/swarm/client';

const reported = vi.hoisted(() => ({ outcomes: [] as unknown[] }));

vi.mock('../src/app/AppProvider', () => ({
  useAppContext: () => ({
    swarm: {
      statusOf: () => ({ state: 'ready' }),
      reader: () => ({
        urlFor: (reference: string) => `https://gateway.example.com/bzz/${reference}/`,
        reportUrlLoad: (outcome: unknown) => reported.outcomes.push(outcome),
      }),
    },
  }),
}));

afterEach(() => {
  reported.outcomes.length = 0;
  document.body.innerHTML = '';
});

describe("a segment hls.js could not load, as the video's failure", () => {
  it('is a load error or a timeout, with the status the source answered', () => {
    expect(segmentLoadFailure({ details: ErrorDetails.FRAG_LOAD_ERROR, response: { code: 503, text: '' } })).toEqual({
      loaded: false,
      status: 503,
    });
    expect(segmentLoadFailure({ details: ErrorDetails.FRAG_LOAD_TIMEOUT })).toEqual({ loaded: false, status: null });
    expect(segmentLoadFailure({ details: ErrorDetails.FRAG_LOAD_ERROR, response: { code: 0, text: '' } })).toEqual({
      loaded: false,
      status: null,
    });
  });

  it('is nothing for an error that is not about loading a segment', () => {
    expect(segmentLoadFailure({ details: ErrorDetails.BUFFER_STALLED_ERROR })).toBeNull();
    expect(segmentLoadFailure({ details: ErrorDetails.LEVEL_LOAD_ERROR })).toBeNull();
  });

  it('reaches the reader the player reads through', () => {
    const outcomes: UrlLoadOutcome[] = [];
    const fetcher = new ManifestFetcher();
    fetcher.useSwarm({
      readFeedHead: async () => ({ kind: 'unsupported' }),
      readFeedEntry: async () => ({ kind: 'unsupported' }),
      readSoc: async () => ({ kind: 'unsupported' }),
      readChunk: async () => ({ kind: 'unsupported' }),
      readBytes: async () => ({ kind: 'unsupported' }),
      urlFor: () => null,
      reportUrlLoad: (outcome) => outcomes.push(outcome),
    });

    fetcher.reportSegmentLoad({ loaded: false, status: 502 });
    fetcher.reportSegmentLoad({ loaded: true });

    expect(outcomes).toEqual([{ loaded: false, status: 502 }, { loaded: true }]);
  });
});

describe("a stream card's picture", () => {
  it('reports to the previews whether it loaded', async () => {
    const container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container);
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    await act(async () => {
      root.render(
        createElement(
          MemoryRouter,
          null,
          createElement(StreamPreview, {
            variant: 'fill',
            owner: '0'.repeat(40),
            topic: 'stream-a',
            state: STREAM_STATUS_VOD,
            mediatype: MEDIA_TYPE_VIDEO,
            title: 'Stream A',
            thumbnail: 'ab'.repeat(32),
          }),
        ),
      );
    });
    const picture = container.querySelector('img')!;

    act(() => {
      picture.dispatchEvent(new Event('load'));
    });
    act(() => {
      picture.dispatchEvent(new Event('error'));
    });

    expect(reported.outcomes).toEqual([{ loaded: true }, { loaded: false, status: null }]);
    act(() => root.unmount());
  });
});
