import { describe, expect, it } from 'vitest';

import * as words from '../../src/features/gateway/checkWords';
import { CHECK_STEPS, checkLine } from '../../src/features/gateway/checkWords';

describe("the checks' lines", () => {
  it("are the design's, in its order, for each kind of source", () => {
    expect(CHECK_STEPS.gateway.map((step) => checkLine('gateway', step))).toEqual([
      'Answers over https',
      'Allows this site (CORS)',
      'Bee 2.6 or later',
      'Reads a chunk',
      'Reads bytes',
      "Reads this event's stream list",
    ]);
    expect(CHECK_STEPS['bee-node'].map((step) => checkLine('bee-node', step))).toEqual([
      'Answers, on this computer or at an https address',
      'Allows this site (CORS)',
      'Bee 2.6 or later, ready',
      'Reads a chunk',
      'Reads bytes',
      "Reads this event's stream list",
    ]);
    expect(CHECK_STEPS['weeb-3'].map((step) => checkLine('weeb-3', step))).toEqual([
      'Node started',
      'Connected to a peer',
      'Reads a chunk',
      'Reads bytes',
      "Reads this event's stream list",
    ]);
  });
});

describe('what a failure says', () => {
  const failures = [
    words.NOT_HTTPS,
    words.NOTHING_ANSWERS,
    words.noAnswerFor(12_400),
    words.LOCAL_NETWORK_BLOCKED,
    words.MIXED_CONTENT_BLOCKED,
    words.corsRefused('gateway', 'https://viewer.example.com'),
    words.corsRefused('bee-node', 'https://viewer.example.com'),
    words.NOT_BEE,
    words.notReady({ kind: 'too-old', version: '2.5.0', needed: '2.6.0' }),
    words.notReady({ kind: 'starting' }),
    words.notReady({ kind: 'no-peers' }),
    words.healthRefused(502),
    words.readFailure('a chunk', { kind: 'not-found', serverTimeMs: null }),
    words.readFailure('a chunk', { kind: 'rate-limited', retryAfterMs: null, serverTimeMs: null }),
    words.readFailure('a chunk', { kind: 'unsupported' }),
    words.readFailure('a chunk', { kind: 'unavailable', cause: { kind: 'status', status: 503 } }),
    words.readFailure('a chunk', { kind: 'unavailable', cause: { kind: 'network', error: null } }),
    words.NOT_THE_STREAM_LIST,
    words.NOTHING_TO_READ,
    words.NODE_FAILED,
    words.noPeers(60_000),
  ];

  it.each(failures.map((failure) => [failure.reason, failure]))(
    '%s is a reason and a fix, plain prose',
    (_, failure) => {
      for (const sentence of [failure.reason, failure.fix]) {
        expect(sentence).toMatch(/\.$/);
        expect(sentence).not.toMatch(/[—;]/);
      }
    },
  );

  it('names how long nothing answered, in whole seconds', () => {
    expect(words.noAnswerFor(12_400).reason).toBe('No answer for 12 s.');
  });

  it('tells the viewer what to change on their own node, and the operator what to change on a gateway', () => {
    expect(words.corsRefused('bee-node', 'https://viewer.example.com').fix).toContain('your node');
    expect(words.corsRefused('gateway', 'https://viewer.example.com').fix).toContain('Its operator');
  });
});
