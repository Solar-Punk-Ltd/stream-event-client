import { describe, expect, it } from 'vitest';

import { weeb3StatusWords } from '../../src/shared/nodeInTabStatus';

describe('the node in this browser, in words', () => {
  it('says in one line where the node is: downloading, starting, connecting to peers, ready or failed', () => {
    expect(weeb3StatusWords({ state: 'stopped', peers: 0 })).toBe('Not started');
    expect(weeb3StatusWords({ state: 'starting', peers: 0, download: { receivedBytes: 0, totalBytes: null } })).toBe(
      'Downloading',
    );
    expect(
      weeb3StatusWords({ state: 'starting', peers: 0, download: { receivedBytes: 1_100_000, totalBytes: 2_200_000 } }),
    ).toBe('Downloading 50%');
    expect(
      weeb3StatusWords({ state: 'starting', peers: 0, download: { receivedBytes: 1_100_000, totalBytes: null } }),
    ).toBe('Downloading 1.1 MB');
    expect(weeb3StatusWords({ state: 'starting', peers: 0 })).toBe('Starting');
    expect(weeb3StatusWords({ state: 'starting', peers: 1 })).toBe('Connecting, 1 peer');
    expect(weeb3StatusWords({ state: 'ready', peers: 5 })).toBe('Ready, 5 peers');
    expect(weeb3StatusWords({ state: 'failed', peers: 0 })).toBe('Failed to start');
  });
});
