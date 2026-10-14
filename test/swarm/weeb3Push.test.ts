import { Bytes, Identifier, PrivateKey, Span } from '@ethersphere/bee-js';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { singleOwnerChunkAddress } from '../../src/swarm/singleOwnerChunk';
import type { Weeb3Node } from '../../src/swarm/providers/weeb-3/weeb3Package';
import {
  pushStampedSocThroughWeeb3,
  WEEB3_PUSH_DEADLINE_MS,
  Weeb3PushError,
} from '../../src/swarm/providers/weeb-3/weeb3Push';
import type { Weeb3RuntimeView } from '../../src/swarm/providers/weeb-3/weeb3Provider';

const KEY = new PrivateKey('a7'.repeat(32));
const OWNER = KEY.publicKey().address().toHex();
const IDENTIFIER = '3c'.repeat(32);
const PAYLOAD = new TextEncoder().encode('{"a":"chat message"}');
const DATA = Bytes.concat(Span.fromBigInt(BigInt(PAYLOAD.length)).toUint8Array(), PAYLOAD) as Uint8Array<ArrayBuffer>;
const SIGNATURE = 'ab'.repeat(65);
const STAMP = 'cd'.repeat(113);

const CHUNK = { owner: OWNER, identifier: IDENTIFIER, signature: SIGNATURE, stamp: STAMP, data: DATA };

interface Pushed {
  readonly data: Uint8Array;
  readonly soc: boolean;
  readonly address: Uint8Array;
  readonly stamp: Uint8Array;
}

function runtimeWith(push: Weeb3Node['postPushChunk'], ready = true) {
  const pushed: Pushed[] = [];
  const node = {
    start: () => undefined,
    connectionCount: async () => 3,
    attachStream: async () => undefined,
    free: () => undefined,
    postPushChunk: (data: Uint8Array, soc: boolean, address: Uint8Array, stamp: Uint8Array) => {
      pushed.push({ data, soc, address, stamp });
      return push(data, soc, address, stamp);
    },
  } as Weeb3Node;
  const runtime = {
    holds: 0,
    status: () => ({ state: ready ? 'ready' : 'failed', peers: 3 }) as const,
    async acquire() {
      runtime.holds += 1;
      return node;
    },
    release() {
      runtime.holds -= 1;
    },
    whenReady: () => (ready ? Promise.resolve(node) : Promise.reject(new Error('the node failed to start'))),
  } satisfies Weeb3RuntimeView & { holds: number };
  return { runtime, pushed };
}

const hex = (bytes: Uint8Array) => new Bytes(bytes).toHex();

afterEach(() => {
  vi.useRealTimers();
});

describe('a stamped single-owner chunk pushed through weeb-3', () => {
  it('hands weeb-3 the whole chunk, identifier, signature, span and payload, at its address, with the stamp', async () => {
    const { runtime, pushed } = runtimeWith(async () => 'Upload result: success');

    await pushStampedSocThroughWeeb3(CHUNK, { runtime });

    expect(pushed).toHaveLength(1);
    expect(pushed[0].soc).toBe(true);
    expect(hex(pushed[0].data)).toBe(`${IDENTIFIER}${SIGNATURE}${hex(DATA)}`);
    expect(hex(pushed[0].address)).toBe(singleOwnerChunkAddress(new Identifier(IDENTIFIER), OWNER));
    expect(hex(pushed[0].stamp)).toBe(STAMP);
    expect(runtime.holds, 'the node is held for the push and let go after').toBe(0);
  });

  it('fails with the deadline when weeb-3 never answers, which is how it treats a stamp it will not take', async () => {
    vi.useFakeTimers();
    const { runtime } = runtimeWith(() => new Promise(() => undefined));

    const pushing = pushStampedSocThroughWeeb3(CHUNK, { runtime }).catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(WEEB3_PUSH_DEADLINE_MS);
    const error = await pushing;

    expect(error).toBeInstanceOf(Weeb3PushError);
    expect((error as Weeb3PushError).reason).toBe('deadline');
    expect(runtime.holds).toBe(0);
  });

  it('gives weeb-3 a minute, longer than the 15 s its slowest measured push took', () => {
    expect(WEEB3_PUSH_DEADLINE_MS).toBe(60_000);
  });

  it('fails as refused, with what weeb-3 said, when it answers anything but success', async () => {
    const { runtime } = runtimeWith(async () => 'Upload result: invalid stamp');

    const error = await pushStampedSocThroughWeeb3(CHUNK, { runtime }).catch((reason: unknown) => reason);

    expect(error).toMatchObject({ reason: 'refused', detail: 'Upload result: invalid stamp' });
  });

  it('fails as refused when weeb-3 rejects the push', async () => {
    const { runtime } = runtimeWith(async () => Promise.reject(new Error('pushChunk requires stamp')));

    const error = await pushStampedSocThroughWeeb3(CHUNK, { runtime }).catch((reason: unknown) => reason);

    expect(error).toMatchObject({ reason: 'refused', detail: 'pushChunk requires stamp' });
  });

  it('fails as the node not running when it cannot start, and pushes nothing', async () => {
    const { runtime, pushed } = runtimeWith(async () => 'Upload result: success', false);

    const error = await pushStampedSocThroughWeeb3(CHUNK, { runtime }).catch((reason: unknown) => reason);

    expect(error).toMatchObject({ reason: 'node' });
    expect(pushed).toEqual([]);
    expect(runtime.holds).toBe(0);
  });

  it.each([112, 114, 0])(
    'refuses a stamp of %i bytes before asking the node, since a stamp is exactly 113',
    async (bytes) => {
      const { runtime, pushed } = runtimeWith(async () => 'Upload result: success');

      const error = await pushStampedSocThroughWeeb3({ ...CHUNK, stamp: 'cd'.repeat(bytes) }, { runtime }).catch(
        (reason: unknown) => reason,
      );

      expect(error).toMatchObject({ reason: 'stamp-size' });
      expect(pushed).toEqual([]);
      expect(runtime.holds).toBe(0);
    },
  );
});
