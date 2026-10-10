import { describe, expect, it } from 'vitest';

import { healthyPeersNote, weeb3StatusWords } from '../../src/shared/nodeInTabStatus';
import type { ProviderStatus } from '../../src/swarm/provider';

const HEALTHY = 200;
const connecting = (peers: number): ProviderStatus => ({ state: 'starting', peers, healthyPeers: HEALTHY });
const ready = (peers: number): ProviderStatus => ({ state: 'ready', peers, healthyPeers: HEALTHY });

describe('the node in this browser, in words', () => {
  it('says how far the download has got, then that the node is starting', () => {
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
    expect(weeb3StatusWords(connecting(0))).toBe('Starting');
    expect(weeb3StatusWords({ state: 'failed', peers: 0, healthyPeers: HEALTHY })).toBe('Failed to start');
  });

  it('counts the peers it builds up to against the healthy count, while connecting and once in use', () => {
    expect(weeb3StatusWords(connecting(1))).toBe('Connecting, 1 of 200 peers');
    expect(weeb3StatusWords(ready(1))).toBe('1 of 200 peers');
    expect(weeb3StatusWords(ready(88))).toBe('88 of 200 peers');
    expect(weeb3StatusWords(ready(200))).toBe('200 of 200 peers');
  });

  it('adds one short note while the count is under the healthy one, and drops it there', () => {
    expect(healthyPeersNote(connecting(0))).toBe('200 peers is the healthy target');
    expect(healthyPeersNote(connecting(1))).toBe('200 peers is the healthy target');
    expect(healthyPeersNote(ready(88))).toBe('200 peers is the healthy target');
    expect(healthyPeersNote(ready(200))).toBeNull();
    expect(healthyPeersNote({ state: 'failed', peers: 0, healthyPeers: HEALTHY })).toBeNull();
    expect(
      healthyPeersNote({ ...connecting(0), download: { receivedBytes: 0, totalBytes: null } }),
      'not while it downloads',
    ).toBeNull();
  });
});
