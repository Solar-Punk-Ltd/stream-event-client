import { describe, expect, it } from 'vitest';

import { diffMetrics, parseMetrics } from '../src/metrics.ts';

const BEFORE = `# HELP bee_pusher_total Pushed chunks.
# TYPE bee_pusher_total counter
bee_pusher_total 10
bee_api_request_count{method="GET",path="/chunks"} 4
bee_gone 1
bee_still 2.5
`;
const AFTER = `bee_pusher_total 25
bee_api_request_count{method="GET",path="/chunks"} 5
bee_new{kind="a b"} 3
bee_still 2.5
bee_nan NaN
`;

describe('parseMetrics', () => {
  it('reads each series with its labels and skips comments and blank lines', () => {
    const series = parseMetrics(BEFORE);
    expect(series.get('bee_pusher_total')).toBe(10);
    expect(series.get('bee_api_request_count{method="GET",path="/chunks"}')).toBe(4);
    expect(series.size).toBe(4);
  });

  it('keeps a label value that holds a space', () => {
    expect(parseMetrics(AFTER).get('bee_new{kind="a b"}')).toBe(3);
  });
});

describe('diffMetrics', () => {
  it('ranks every series by how far it moved, and names the ones that appeared or vanished', () => {
    const diff = diffMetrics(parseMetrics(BEFORE), parseMetrics(AFTER));
    expect(diff.map((row) => [row.series, row.change])).toEqual([
      ['bee_pusher_total', 15],
      ['bee_new{kind="a b"}', 3],
      ['bee_api_request_count{method="GET",path="/chunks"}', 1],
      ['bee_gone', -1],
    ]);
    expect(diff.find((row) => row.series === 'bee_new{kind="a b"}')).toMatchObject({ before: null, after: 3 });
    expect(diff.find((row) => row.series === 'bee_gone')).toMatchObject({ before: 1, after: null });
  });

  it('gives each move relative to where it started, a series that appeared counting as wholly new', () => {
    const diff = diffMetrics(parseMetrics(BEFORE), parseMetrics(AFTER));
    expect(diff.find((row) => row.series === 'bee_pusher_total')?.relative).toBe(1.5);
    expect(diff.find((row) => row.series === 'bee_gone')?.relative).toBe(-1);
    expect(diff.find((row) => row.series === 'bee_new{kind="a b"}')?.relative).toBe(Infinity);
  });

  it('leaves out the series that did not move and a value that is not a number', () => {
    const diff = diffMetrics(parseMetrics(BEFORE), parseMetrics(AFTER));
    expect(diff.some((row) => row.series === 'bee_still')).toBe(false);
    expect(diff.some((row) => row.series === 'bee_nan')).toBe(false);
  });
});
