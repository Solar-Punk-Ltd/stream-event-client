import { describe, expect, it } from 'vitest';

import { judgeCountsGate, needsServerCounts } from '../src/liveCounts.ts';
import { parseStep } from '../src/scenario.ts';

const steps = (...lines: string[]) => lines.map((line) => parseStep(line));

describe('needsServerCounts', () => {
  it('names the scenarios that read the chat server counts: a snapshot, a forge or a replay', () => {
    expect(needsServerCounts(steps('alice snapshot-drops', 'expect server-dropped alice reasons=binding'))).toBe(true);
    expect(needsServerCounts(steps('alice evil forge message'))).toBe(true);
    expect(needsServerCounts(steps('alice evil replay "once {run}"'))).toBe(true);
  });

  it('leaves out a scenario that only drives the hostile site in a browser', () => {
    expect(needsServerCounts(steps('alice evil visit unlisted', 'expect evil-refused alice'))).toBe(false);
    expect(needsServerCounts(steps('alice create-account password', 'alice sign-in viewer'))).toBe(false);
  });
});

describe('judgeCountsGate', () => {
  const failing = (reading: Parameters<typeof judgeCountsGate>[0]) => judgeCountsGate(reading).filter((c) => !c.ok);

  it('passes when the tunnel answers the chat server health with its counts', () => {
    expect(failing({ address: 'http://127.0.0.1:4997', status: 200, counts: true })).toEqual([]);
  });

  it('refuses without a chatHealth in the target, naming the tunnel to open and where to name its end', () => {
    const [check] = failing({ address: null, status: null, counts: false });
    expect(check.name).toBe('chat server counts');
    expect(check.detail).toMatch(/ssh -N -L 4997:127\.0\.0\.1:<its health port> <the deployment's host>/);
    expect(check.detail).toMatch(/chatHealth/);
  });

  it('refuses a tunnel that does not answer, or answers with something that is not the chat server', () => {
    expect(failing({ address: 'http://127.0.0.1:4997', status: null, counts: false })[0].detail).toMatch(
      /answered nothing.*ssh -N -L/,
    );
    expect(failing({ address: 'http://127.0.0.1:4997', status: 200, counts: false })[0].detail).toMatch(/no counts/);
    expect(failing({ address: 'http://127.0.0.1:4997', status: 503, counts: true })[0].detail).toMatch(/503/);
  });
});
