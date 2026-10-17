import { describe, expect, it } from 'vitest';

import { deviceFeedExposure, deviceFeedLeaks } from '../src/deviceFeed.ts';

describe('deviceFeedLeaks', () => {
  it('finds a connected site app secret and a stamp signer key the feed should not carry', () => {
    const account = {
      connectedApps: [
        { appUrl: 'http://127.0.0.1:4180', appSecret: 'ab'.repeat(32) },
        { appUrl: 'http://example.test' },
      ],
      postageStamps: [{ batchID: 'cd'.repeat(32), signerKey: 'ef'.repeat(32) }],
    };
    expect(deviceFeedLeaks(account)).toEqual([
      'app secret for http://127.0.0.1:4180',
      'stamp signer key for cdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcd',
    ]);
  });

  it('finds nothing in a feed that carries no app secret and no signer key, which is the fixed state', () => {
    expect(
      deviceFeedLeaks({
        connectedApps: [{ appUrl: 'http://127.0.0.1:4180' }],
        postageStamps: [{ batchID: 'cd'.repeat(32) }],
      }),
    ).toEqual([]);
  });

  it('reads a batch id and a signer key given as objects, as bee-js hands them back', () => {
    expect(
      deviceFeedLeaks({
        connectedApps: [],
        postageStamps: [{ batchID: { toString: () => 'aa' }, signerKey: { toString: () => 'bb' } }],
      }),
    ).toEqual(['stamp signer key for aa']);
  });
});

describe('deviceFeedExposure', () => {
  it('names a pointer that carries the key to its state and every secret that key opened', () => {
    expect(
      deviceFeedExposure([
        { deviceId: 'd1', keyInPointer: true, secrets: ['app secret for http://127.0.0.1:4180'] },
        { deviceId: 'd2', keyInPointer: false, secrets: [] },
      ]),
    ).toEqual(['the pointer of device d1 carries the key to its state', 'app secret for http://127.0.0.1:4180']);
  });

  it('finds nothing when no pointer carries a key, so an outsider opens nothing', () => {
    expect(deviceFeedExposure([{ deviceId: 'd1', keyInPointer: false, secrets: [] }])).toEqual([]);
  });
});
