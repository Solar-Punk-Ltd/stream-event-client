import assert from 'node:assert/strict';
import { describe, it } from 'vitest';

import { SourceMissCost } from '../src/features/player/sourceMissCost';

function costOf(missesMs: readonly number[]): SourceMissCost {
  const cost = new SourceMissCost();
  for (const missMs of missesMs) {
    cost.record(missMs);
  }
  return cost;
}

describe('what makes a source slow', () => {
  it('is not one slow first miss among fast ones, as a cold connection gives', () => {
    for (let fast = 1; fast <= 6; fast++) {
      const cost = costOf([4_000, ...Array.from({ length: fast }, () => 1_400)]);

      assert.equal(cost.isSlow(), false, `slow after one 4 s miss and ${fast} fast ones`);
      assert.equal(cost.readWindowMs(), null);
    }
  });

  it('is not a single slow miss, which is all a cold start has shown', () => {
    assert.equal(costOf([4_000]).isSlow(), false);
  });

  it('is two misses both slow, as the light node had answered when its first 20 s ran out', () => {
    assert.equal(costOf([5_700, 5_800]).isSlow(), true);
  });

  it('is the light node, whose misses take 6 to 7 s', () => {
    assert.equal(costOf([6_200, 7_100, 5_800, 6_900, 6_400, 7_000]).isSlow(), true);
  });
});
