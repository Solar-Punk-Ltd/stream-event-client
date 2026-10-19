import { describe, expect, it } from 'vitest';

import { startHasPassed } from '../src/features/catalog/scheduledStart';
import { callToAction, cardDateLabel, startDateTimeLabel, streamLabel } from '../src/features/catalog/streamLabels';
import { STREAM_STATUS_LIVE, STREAM_STATUS_SCHEDULED, STREAM_STATUS_VOD } from '../src/features/catalog/stream';

const EN_UTC = { locale: 'en-US', timeZone: 'UTC' };
const HELD = Date.parse('2026-09-30T18:45:00Z');

describe('the words on a stream card', () => {
  it('names a stream live, upcoming, or a recording', () => {
    expect(streamLabel(STREAM_STATUS_LIVE)).toBe('Live');
    expect(streamLabel(STREAM_STATUS_SCHEDULED)).toBe('Upcoming');
    expect(streamLabel(STREAM_STATUS_VOD)).toBe('Recording');
    expect(streamLabel('archived')).toBe('Recording');
  });

  it('says an upcoming stream whose start has passed is past its start time, and changes no other label', () => {
    expect(streamLabel(STREAM_STATUS_SCHEDULED, true)).toBe('Start time passed');
    expect(streamLabel(STREAM_STATUS_LIVE, true)).toBe('Live');
    expect(streamLabel(STREAM_STATUS_VOD, true)).toBe('Recording');
  });

  it('counts a start as passed only once the clock is beyond it', () => {
    expect(startHasPassed('2026-09-30T18:45:00Z', HELD + 1)).toBe(true);
    expect(startHasPassed('2026-09-30T18:45:00Z', HELD)).toBe(false);
    expect(startHasPassed('2026-09-30T18:45:00Z', HELD - 1)).toBe(false);
    expect(startHasPassed(null, HELD)).toBe(false);
    expect(startHasPassed('not a time', HELD)).toBe(false);
  });

  it('offers to join a live or upcoming stream, and to watch a recording', () => {
    expect(callToAction(STREAM_STATUS_LIVE)).toBe('Join stream & chat →');
    expect(callToAction(STREAM_STATUS_SCHEDULED)).toBe('Join stream & chat →');
    expect(callToAction(STREAM_STATUS_VOD)).toBe('Watch on Swarm →');
  });
});

describe('the date on a stream card', () => {
  it('dates a recording by its scheduled start when it has one, without the time', () => {
    const stream = { state: STREAM_STATUS_VOD, timestamp: HELD, scheduledStartTime: '2026-09-24T15:00:00Z' };

    expect(cardDateLabel(stream, EN_UTC)).toBe('September 24, 2026');
  });

  it('dates a recording with no scheduled start by when it was published', () => {
    expect(cardDateLabel({ state: STREAM_STATUS_VOD, timestamp: HELD }, EN_UTC)).toBe('September 30, 2026');
  });

  it('gives an upcoming stream its start time as well', () => {
    const stream = { state: STREAM_STATUS_SCHEDULED, timestamp: HELD, scheduledStartTime: '2026-10-30T00:00:00Z' };

    expect(cardDateLabel(stream, EN_UTC)).toBe('October 30, 2026 at 12:00 AM');
  });

  it('gives an upcoming stream with no start time no date, rather than the day it was announced', () => {
    expect(cardDateLabel({ state: STREAM_STATUS_SCHEDULED, timestamp: HELD, scheduledStartTime: null }, EN_UTC)).toBe(
      null,
    );
  });

  it('writes a start with its date and time', () => {
    expect(startDateTimeLabel(Date.parse('2026-11-04T09:30:00Z'), EN_UTC)).toBe('November 4, 2026 at 09:30 AM');
  });
});
