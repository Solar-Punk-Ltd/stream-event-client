import { Topic } from '@ethersphere/bee-js';
import assert from 'node:assert/strict';
import { describe, it } from 'vitest';

import {
  encodeLadderMarker,
  ladderMarkerIdentifier,
  type LadderMarker,
  markerPeriodAt,
  markerPeriodStartMs,
  parseLadderMarker,
} from '../../src/shared/ladderMarker.js';

const RUNG_360 = 'a'.repeat(64);
const RUNG_720 = '0123456789abcdef'.repeat(4);

/**
 * The monorepo's own frozen vectors, the ones its `ladderMarker.test.ts` checks its helper against at
 * 9e98009d. Run there on 2026-10-07, all three passed, so these are what the uploader's code computes.
 * The same numbers here mean the reader and the writer agree on the address, and a change to either
 * side that the other has not taken fails here.
 *
 * Only the first 64 bits of each hash, as the monorepo keeps them: the machine's secret guard refuses
 * a full 32-byte hex literal, and 64 bits tell one byte layout from another.
 */
const UPLOADER_VECTORS = [
  {
    group: 'ladder-marker-vector-group',
    period: 0,
    topicPrefix: '0d5e5bb0926a65e5',
    identifierPrefix: 'f6b46271eff0479d',
  },
  {
    group: 'ladder-marker-vector-group',
    period: 175_983_840,
    topicPrefix: '0d5e5bb0926a65e5',
    identifierPrefix: 'a2f6848ee95311e3',
  },
  {
    group: '3f2b8c4e-1d2a-4b6f-9e0a-7c5d4e3f2a1b',
    period: 1_099_511_627_781,
    topicPrefix: '3ee91f4778abbdde',
    identifierPrefix: '3359b2fcd770d32e',
  },
];

function validMarker(overrides: Partial<LadderMarker> = {}): LadderMarker {
  return {
    v: 2,
    period: 175_983_840,
    writtenAt: 1_759_838_400_250,
    rungs: { [RUNG_360]: 41, [RUNG_720]: 0 },
    segmentMs: 2_000,
    ...overrides,
  };
}

describe('the ladder marker convention, as the uploader writes it', () => {
  for (const vector of UPLOADER_VECTORS) {
    it(`computes the uploader's identifier for period ${vector.period}`, () => {
      const topic = Topic.fromString(vector.group);
      assert.ok(topic.toHex().startsWith(vector.topicPrefix));
      const identifier = ladderMarkerIdentifier(topic, vector.period).toHex();
      assert.equal(identifier.length, 64);
      assert.equal(identifier.slice(0, vector.identifierPrefix.length), vector.identifierPrefix);
    });
  }

  it('counts ten-second periods of global time', () => {
    assert.equal(markerPeriodAt(1_759_838_405_123), 175_983_840);
    assert.equal(markerPeriodStartMs(175_983_840), 1_759_838_400_000);
  });

  it('reads back what the uploader encodes', () => {
    const marker = validMarker();
    assert.deepEqual(parseLadderMarker(new TextDecoder().decode(encodeLadderMarker(marker)), marker.period), marker);
  });

  it('reads the segment length a version 2 marker names', () => {
    const text = new TextDecoder().decode(encodeLadderMarker(validMarker({ segmentMs: 500 })));
    assert.equal(parseLadderMarker(text)?.segmentMs, 500);
  });

  /** Only test builds wrote version 1, which names no segment length, and nothing has written it since 2026-10-09. */
  it('reads a version 1 marker as no marker, as any version it does not know', () => {
    const { segmentMs: _segmentMs, ...rest } = validMarker();
    assert.equal(parseLadderMarker(JSON.stringify({ ...rest, v: 1 })), null);
    assert.equal(parseLadderMarker(JSON.stringify({ ...rest, v: 1 }), rest.period), null);
  });

  const refused: Array<[string, string]> = [
    ['text that is not JSON', '{"v":1,'],
    ['another version', JSON.stringify(validMarker({ v: 3 as 2 }))],
    ['a version 2 marker without a segment length', JSON.stringify({ ...validMarker(), segmentMs: undefined })],
    ['a segment length of zero', JSON.stringify(validMarker({ segmentMs: 0 }))],
    ['an extra field', JSON.stringify({ ...validMarker(), note: 'x' })],
    ['a write time outside its own period', JSON.stringify(validMarker({ writtenAt: 1_759_838_410_000 }))],
    ['no rungs at all', JSON.stringify(validMarker({ rungs: {} }))],
    ['an uppercase rung topic', JSON.stringify(validMarker({ rungs: { [RUNG_360.toUpperCase()]: 1 } }))],
    ['a negative index', JSON.stringify(validMarker({ rungs: { [RUNG_360]: -1 } }))],
  ];
  for (const [what, text] of refused) {
    it(`treats ${what} as no marker`, () => {
      assert.equal(parseLadderMarker(text), null);
    });
  }

  it('treats a marker for another period than the address was computed for as no marker', () => {
    assert.equal(parseLadderMarker(JSON.stringify(validMarker()), 175_983_841), null);
  });
});
