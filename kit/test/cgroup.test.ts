import { describe, expect, it } from 'vitest';

import { parseCpuMax } from '../src/cgroup.ts';

describe('parseCpuMax', () => {
  it('reads a quota over a period as a number of cpus', () => {
    expect(parseCpuMax('600000 100000\n')).toBe(6);
    expect(parseCpuMax('150000 100000')).toBe(1.5);
  });

  it('reads no cap as null, and anything else as null too', () => {
    expect(parseCpuMax('max 100000')).toBeNull();
    expect(parseCpuMax('')).toBeNull();
    expect(parseCpuMax('garbage')).toBeNull();
  });
});
