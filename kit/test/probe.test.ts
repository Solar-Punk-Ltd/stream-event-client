import { describe, expect, it } from 'vitest';

import { Addressing } from '../src/addresses.ts';
import { chooseScheme } from '../src/probe.ts';

const reading = (partitioned: boolean, bindingAccepted: boolean) => ({
  viewer: 'v',
  swarmId: 's',
  partitioned,
  bindingAccepted,
  bindingReason: bindingAccepted ? 'accepted' : 'refused',
});

describe('chooseScheme', () => {
  it('serves the loopback scheme when the names cannot carry a binding', () => {
    const schemes = { [Addressing.NAMES]: reading(true, false), [Addressing.LOOPBACK]: reading(true, true) };
    expect(chooseScheme(schemes, true).chosen).toBe(Addressing.LOOPBACK);
  });

  it('chooses nothing when the plain browser partitions too, since the measurement then shows nothing', () => {
    const schemes = { [Addressing.NAMES]: reading(true, true), [Addressing.LOOPBACK]: reading(true, true) };
    const choice = chooseScheme(schemes, false);
    expect(choice.chosen).toBeNull();
    expect(choice.reason).toMatch(/control/);
  });
});
