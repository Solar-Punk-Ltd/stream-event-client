import { describe, expect, it } from 'vitest';

import { browseSections, displayedStreams, streamGroups } from '../src/features/catalog/StreamList/displayedStreams';
import {
  type Stream,
  STREAM_STATUS_LIVE,
  STREAM_STATUS_SCHEDULED,
  STREAM_STATUS_VOD,
} from '../src/features/catalog/stream';

function entry(index: number, state: string, timestamp: number, scheduledStartTime?: string | null): Stream {
  return {
    owner: '0x' + '1'.repeat(40),
    topic: `topic-${index}`,
    title: `Stage ${index}`,
    timestamp,
    mediatype: 'video',
    state,
    index,
    ...(scheduledStartTime !== undefined && { scheduledStartTime }),
  };
}

const NOW = Date.parse('2026-11-04T12:00:00Z');
const BEFORE_EVERY_START = Date.parse('2026-11-01T00:00:00Z');

describe('the streams the browse page shows', () => {
  it('shows every entry of a catalog of twelve', () => {
    const catalog = Array.from({ length: 12 }, (_, i) => entry(i, STREAM_STATUS_VOD, 1_000 + i));

    expect(displayedStreams(catalog, BEFORE_EVERY_START)).toHaveLength(12);
  });

  it('keeps the oldest entry of a long catalog', () => {
    const catalog = Array.from({ length: 30 }, (_, i) => entry(i, STREAM_STATUS_VOD, 1_000 + i));

    expect(displayedStreams(catalog, BEFORE_EVERY_START).map((stream) => stream.topic)).toContain('topic-0');
  });

  it('puts live streams first, then upcoming soonest first, then finished newest first', () => {
    const catalog = [
      entry(0, STREAM_STATUS_VOD, 1_000),
      entry(1, STREAM_STATUS_LIVE, 1_001),
      entry(2, STREAM_STATUS_SCHEDULED, 1_002, '2026-11-05T10:00:00Z'),
      entry(3, STREAM_STATUS_LIVE, 1_003),
      entry(4, STREAM_STATUS_VOD, 1_004),
      entry(5, STREAM_STATUS_SCHEDULED, 1_005, '2026-11-03T09:00:00Z'),
      entry(6, STREAM_STATUS_SCHEDULED, 1_006, '2026-11-04T09:00:00Z'),
    ];

    expect(displayedStreams(catalog, BEFORE_EVERY_START).map((stream) => stream.topic)).toEqual([
      'topic-3',
      'topic-1',
      'topic-5',
      'topic-6',
      'topic-2',
      'topic-4',
      'topic-0',
    ]);
  });

  it('puts an upcoming stream with no start time after the ones that have one', () => {
    const catalog = [
      entry(0, STREAM_STATUS_SCHEDULED, 1_000, null),
      entry(1, STREAM_STATUS_SCHEDULED, 1_001, '2026-11-06T09:00:00Z'),
      entry(2, STREAM_STATUS_SCHEDULED, 1_002, 'not a time'),
    ];

    expect(displayedStreams(catalog, BEFORE_EVERY_START).map((stream) => stream.topic)).toEqual([
      'topic-1',
      'topic-2',
      'topic-0',
    ]);
  });

  it('puts upcoming streams still ahead first, soonest first, then those past their start, the most recent first, then those with no start', () => {
    const catalog = [
      entry(0, STREAM_STATUS_SCHEDULED, 1_000, '2026-11-03T09:00:00Z'),
      entry(1, STREAM_STATUS_SCHEDULED, 1_001, '2026-11-06T09:00:00Z'),
      entry(2, STREAM_STATUS_SCHEDULED, 1_002, null),
      entry(3, STREAM_STATUS_SCHEDULED, 1_003, '2026-11-04T09:00:00Z'),
      entry(4, STREAM_STATUS_SCHEDULED, 1_004, '2026-11-05T09:00:00Z'),
    ];

    expect(displayedStreams(catalog, NOW).map((stream) => stream.topic)).toEqual([
      'topic-4',
      'topic-1',
      'topic-3',
      'topic-0',
      'topic-2',
    ]);
  });

  it('files a state it does not know with the finished streams', () => {
    const catalog = [entry(0, 'archived', 1_000), entry(1, STREAM_STATUS_SCHEDULED, 1_001, '2026-11-03T09:00:00Z')];

    expect(streamGroups(catalog, BEFORE_EVERY_START)).toEqual({
      live: [],
      upcoming: [catalog[1]],
      finished: [catalog[0]],
    });
  });

  it('leaves the catalog it was handed as it was', () => {
    const catalog = [entry(0, STREAM_STATUS_VOD, 1_000), entry(1, STREAM_STATUS_LIVE, 1_001)];
    const before = catalog.map((stream) => stream.topic);

    displayedStreams(catalog, BEFORE_EVERY_START);

    expect(catalog.map((stream) => stream.topic)).toEqual(before);
  });
});

describe('the sections of the browse page', () => {
  it('features the soonest upcoming stream that has not reached its start time', () => {
    const catalog = [
      entry(0, STREAM_STATUS_SCHEDULED, 1_000, '2026-11-04T09:00:00Z'),
      entry(1, STREAM_STATUS_SCHEDULED, 1_001, '2026-11-06T09:00:00Z'),
      entry(2, STREAM_STATUS_SCHEDULED, 1_002, '2026-11-05T09:00:00Z'),
    ];

    const sections = browseSections(catalog, NOW);

    expect(sections.next?.topic).toBe('topic-2');
    expect(sections.upcoming.map((stream) => stream.topic)).toEqual(['topic-1', 'topic-0']);
  });

  it('features the first upcoming stream when every start time has passed or is unknown', () => {
    const catalog = [
      entry(0, STREAM_STATUS_SCHEDULED, 1_000, null),
      entry(1, STREAM_STATUS_SCHEDULED, 1_001, '2026-11-03T09:00:00Z'),
    ];

    const sections = browseSections(catalog, NOW);

    expect(sections.next?.topic).toBe('topic-1');
    expect(sections.upcoming.map((stream) => stream.topic)).toEqual(['topic-0']);
  });

  it('features the stream whose start passed most recently when no start is ahead', () => {
    const catalog = [
      entry(0, STREAM_STATUS_SCHEDULED, 1_000, '2026-11-01T09:00:00Z'),
      entry(1, STREAM_STATUS_SCHEDULED, 1_001, '2026-11-03T09:00:00Z'),
      entry(2, STREAM_STATUS_SCHEDULED, 1_002, null),
    ];

    const sections = browseSections(catalog, NOW);

    expect(sections.next?.topic).toBe('topic-1');
    expect(sections.upcoming.map((stream) => stream.topic)).toEqual(['topic-0', 'topic-2']);
  });

  it('features nothing when no stream is upcoming', () => {
    expect(browseSections([entry(0, STREAM_STATUS_VOD, 1_000)], NOW).next).toBeNull();
  });

  it('moves the feature on once the clock passes its start time', () => {
    const catalog = [
      entry(0, STREAM_STATUS_SCHEDULED, 1_000, '2026-11-04T12:10:00Z'),
      entry(1, STREAM_STATUS_SCHEDULED, 1_001, '2026-11-04T15:00:00Z'),
    ];

    expect(browseSections(catalog, NOW).next?.topic).toBe('topic-0');
    expect(browseSections(catalog, Date.parse('2026-11-04T12:30:00Z')).next?.topic).toBe('topic-1');
  });

  it('keeps every live stream, and the finished ones newest first as past streams', () => {
    const catalog = [
      entry(0, STREAM_STATUS_VOD, 1_000),
      entry(1, STREAM_STATUS_LIVE, 1_001),
      entry(2, STREAM_STATUS_LIVE, 1_002),
      entry(3, STREAM_STATUS_VOD, 1_003),
    ];

    const sections = browseSections(catalog, NOW);

    expect(sections.live.map((stream) => stream.topic)).toEqual(['topic-2', 'topic-1']);
    expect(sections.past.map((stream) => stream.topic)).toEqual(['topic-3', 'topic-0']);
  });
});
