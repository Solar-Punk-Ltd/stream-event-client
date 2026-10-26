import { describe, expect, it } from 'vitest';

import { type FreedomSwarm, siteConnection } from '../../src/swarm/providers/freedom/freedomSwarm';

/** A `window.swarm` that answers `swarm_getCapabilities` with `capabilities`. */
const answering = (capabilities: unknown): FreedomSwarm => ({
  isFreedomBrowser: true,
  request: () => Promise.resolve(capabilities),
});

describe('whether Freedom counts this site as connected', () => {
  it('reads it from the reason Freedom names, null where nothing holds the site back', async () => {
    expect(await siteConnection(answering({ specVersion: '1.0', reason: null }))).toBe('connected');
    expect(await siteConnection(answering({ specVersion: '1.0', reason: 'node-stopped' }))).toBe('connected');
    expect(await siteConnection(answering({ specVersion: '1.0', reason: 'not-connected' }))).toBe('not-connected');
  });

  it.each<[string, unknown]>([
    ['nothing', null],
    ['a number', 7],
    ['an object with no reason', {}],
    ['a reason that is not a word', { reason: 3 }],
  ])('does not know for capabilities of %s', async (_what, capabilities) => {
    expect(await siteConnection(answering(capabilities))).toBe('unknown');
  });

  it('does not know outside Freedom, or where Freedom fails the call', async () => {
    expect(await siteConnection(null)).toBe('unknown');
    expect(await siteConnection({ isFreedomBrowser: true, request: () => Promise.reject(new Error('no')) })).toBe(
      'unknown',
    );
  });
});
