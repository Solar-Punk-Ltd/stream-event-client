import { describe, expect, it } from 'vitest';

import { OutsideRequests } from '../src/outside.ts';

describe('OutsideRequests', () => {
  it('hands each stopped request over once, known ones with why and unknown ones apart', () => {
    const alice = { name: 'alice', blocked: ['GET https://rsms.me/inter/inter.css'] };
    const bob = { name: 'bob', blocked: [] as string[] };
    const outside = new OutsideRequests([alice, bob]);
    const first = outside.since();
    expect(first.known).toEqual([
      { actor: 'alice', request: 'GET https://rsms.me/inter/inter.css', why: expect.stringContaining('font') },
    ]);
    expect(first.unknown).toEqual([]);
    expect(outside.since()).toEqual({ known: [], unknown: [] });
  });

  it('catches a request stopped between two steps or after the last, at the next look', () => {
    const alice = { name: 'alice', blocked: [] as string[] };
    const outside = new OutsideRequests([alice]);
    expect(outside.since()).toEqual({ known: [], unknown: [] });
    alice.blocked.push('GET https://tracker.example/pixel');
    expect(outside.since().unknown).toEqual(['alice: GET https://tracker.example/pixel']);
  });

  it("hands a request the guard's own control asked for over as the control, never as a failure", () => {
    const alice = { name: 'alice', blocked: ['GET https://example.com/'] };
    const controls = new Set(['GET https://example.com/']);
    expect(new OutsideRequests([alice], controls).since()).toEqual({
      known: [{ actor: 'alice', request: 'GET https://example.com/', why: expect.stringContaining('control') }],
      unknown: [],
    });
  });
});
