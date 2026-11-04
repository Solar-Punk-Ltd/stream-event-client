import { describe, expect, it } from 'vitest';

import { playedBetween, type PlaybackReading } from '../e2e/playback';

const reading = (currentTime: number, framesDecoded: number): PlaybackReading => ({ currentTime, framesDecoded });

// The numbers come from weeb-3 runs on a stream whose timeline does not start at 0.
describe('playedBetween', () => {
  it('takes no position set before any frame for play', () => {
    expect(playedBetween(reading(0, 0), reading(53298.5, 0))).toBe(false);
  });

  it('takes no frames decoded ahead of a position that stays for play', () => {
    expect(playedBetween(reading(53786.5, 0), reading(53786.5, 56))).toBe(false);
  });

  it('takes no jump to the start of the stream, with its first frames, for play', () => {
    expect(playedBetween(reading(0, 0), reading(53298.5, 12))).toBe(false);
  });

  it('takes no video that ran out of data for play', () => {
    expect(playedBetween(reading(10940.4, 56), reading(10940.4, 56))).toBe(false);
  });

  it('takes a position moving on with more frames decoded for play', () => {
    expect(playedBetween(reading(10938.4, 0), reading(10939.3, 31))).toBe(true);
  });
});
