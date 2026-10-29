import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, it, vi } from 'vitest';

import {
  NotAStreamLink,
  UnlistedStreamNote,
  WatchPlaceholder,
} from '../src/features/player/StreamWatcher/WatchPlaceholder';
import {
  WATCH_VIEW_LOADING,
  WATCH_VIEW_NOT_STARTED,
  WATCH_VIEW_PLAYER,
  WATCH_VIEW_UNAVAILABLE,
  type WatchPageView,
} from '../src/features/catalog/watchPageView';

const NOW = Date.UTC(2026, 10, 17, 9, 0);
const DAY = 24 * 60 * 60 * 1000;

vi.mock('../src/app/AppProvider', async () => {
  const { gatewaySwarm } = await import('./helpers/gatewaySwarm');
  const swarm = gatewaySwarm('/bee');
  return { useAppContext: () => ({ swarm }) };
});

const render = (view: WatchPageView, scheduledStart: number | null = null, thumbnail?: string) =>
  renderToStaticMarkup(createElement(WatchPlaceholder, { view, scheduledStart, thumbnail }));

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
});

/**
 * What the watch page says in place of the player. A shared link opens before the catalog has been read, and a first
 * read over a cold gateway takes a while, so the page says it is looking rather than showing nothing.
 */
describe('the watch page in place of the player', () => {
  it('says it is loading while the catalog has not been read', () => {
    assert.match(render(WATCH_VIEW_LOADING), /Loading this stream/);
  });

  it('counts down to an announced start, and names the day it starts', () => {
    const html = render(WATCH_VIEW_NOT_STARTED, NOW + 2 * DAY);
    const day = new Date(NOW + 2 * DAY).toLocaleString(undefined, {
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });

    assert.match(html, /Live in 2 days/);
    assert.ok(html.includes(day), `the start day ${day} is not in ${html}`);
  });

  it('says an announced stream has not started when it names no time', () => {
    const html = render(WATCH_VIEW_NOT_STARTED);

    assert.match(html, /This stream has not started yet\./);
    assert.doesNotMatch(html, /Live in/);
  });

  it('shows the picture the publisher gave an announced stream behind the countdown', () => {
    const html = render(WATCH_VIEW_NOT_STARTED, NOW + DAY, 'abc');

    assert.match(html, /<img[^>]+src="\/bee\/bzz\/abc\/"/);
  });

  it('says a stream that is gone is no longer available', () => {
    assert.match(render(WATCH_VIEW_UNAVAILABLE), /This stream is no longer available\./);
  });

  it('says nothing once the player is showing', () => {
    assert.equal(render(WATCH_VIEW_PLAYER), '');
  });
});

describe('a link the stream list does not carry', () => {
  it('says the stream is not listed and may have been removed, while the player keeps looking', () => {
    const html = renderToStaticMarkup(createElement(UnlistedStreamNote));
    assert.match(html, /not in the stream list/);
    assert.match(html, /removed, or the link may be wrong/);
  });

  it('says a link without a watch link shape names no stream', () => {
    assert.match(renderToStaticMarkup(createElement(NotAStreamLink)), /This link does not name a stream/);
  });
});
