import { describe, expect, it } from 'vitest';

import { parseRuntimeConfig } from '../../src/config/runtimeConfig';
import {
  canMoveFallback,
  fallbackOrderFor,
  moveFallback,
  parseFallbackOrder,
  serializeFallbackOrder,
} from '../../src/swarm/fallbackOrder';
import { swarmSettingsFrom } from '../../src/swarm/settings';

function settings(fallback: unknown) {
  const result = parseRuntimeConfig({
    catalog: { owner: '0x' + '1'.repeat(40), topic: 'event-streams' },
    providers: {
      gateways: ['event', 'a', 'b', 'c'].map((id) => ({ id, kind: 'bee-http', url: `https://${id}.example.com` })),
      default: 'event',
      ...(fallback === undefined ? {} : { fallback }),
    },
  });
  if (!result.ok) {
    throw new Error(result.problem);
  }
  return swarmSettingsFrom(result.config);
}

const THREE = settings(['a', 'b', 'c']);

describe('the order of fallbacks', () => {
  it("is the deployment's order until the viewer changes it, the event gateway last", () => {
    expect(fallbackOrderFor(THREE, null)).toEqual(['a', 'b', 'c', 'event']);
  });

  it("is the viewer's own order of the same gateways, the event gateway still last", () => {
    expect(fallbackOrderFor(THREE, ['c', 'event', 'a', 'b'])).toEqual(['c', 'a', 'b', 'event']);
  });

  it('drops what the deployment no longer falls back to, and adds what it now does in its own place', () => {
    expect(fallbackOrderFor(THREE, ['gone', 'b', 'b', 'a'])).toEqual(['b', 'a', 'c', 'event']);
  });

  it('is just the event gateway for a deployment that names no other', () => {
    expect(fallbackOrderFor(settings(undefined), ['a'])).toEqual(['event']);
  });

  it('is empty when the deployment switched the fallback off, whatever the viewer saved', () => {
    expect(fallbackOrderFor(settings(false), ['a', 'event'])).toEqual([]);
  });
});

describe('moving a fallback', () => {
  const order = ['a', 'b', 'c', 'event'];

  it('moves one up or down by one place', () => {
    expect(moveFallback(order, 'b', -1)).toEqual(['b', 'a', 'c', 'event']);
    expect(moveFallback(order, 'b', 1)).toEqual(['a', 'c', 'b', 'event']);
  });

  it('never moves the event gateway out of last, nor anything below it', () => {
    expect(canMoveFallback(order, 'event', -1)).toBe(false);
    expect(moveFallback(order, 'event', -1)).toEqual(order);
    expect(canMoveFallback(order, 'c', 1)).toBe(false);
    expect(moveFallback(order, 'c', 1)).toEqual(order);
  });

  it('does not move the first one up, or one it does not hold', () => {
    expect(canMoveFallback(order, 'a', -1)).toBe(false);
    expect(moveFallback(order, 'gone', 1)).toEqual(order);
  });
});

describe('the order as the browser keeps it', () => {
  it('survives a round trip', () => {
    expect(parseFallbackOrder(serializeFallbackOrder(['b', 'a', 'event']))).toEqual(['b', 'a', 'event']);
  });

  it('is nothing saved for anything but a list of ids', () => {
    expect(parseFallbackOrder(null)).toBeNull();
    expect(parseFallbackOrder('{oops')).toBeNull();
    expect(parseFallbackOrder('{"a":1}')).toBeNull();
    expect(parseFallbackOrder('["a", 2]')).toEqual(['a']);
  });
});
