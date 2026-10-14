import { describe, expect, it } from 'vitest';

import {
  postStampedSoc,
  StampedUploadError,
  type StampedSoc,
} from '../../src/swarm/providers/bee-http/stampedSocUpload';

const CHUNK: StampedSoc = {
  owner: 'a'.repeat(40),
  identifier: 'b'.repeat(64),
  signature: 'c'.repeat(130),
  stamp: 'd'.repeat(226),
  data: new Uint8Array([5, 0, 0, 0, 0, 0, 0, 0, 1, 2, 3, 4, 5]),
};

interface Asked {
  url: string;
  init: RequestInit;
}

function answering(response: () => Response | Promise<Response>) {
  const asked: Asked[] = [];
  const fetcher: typeof fetch = async (input, init) => {
    asked.push({ url: String(input), init: init ?? {} });
    return response();
  };
  return { asked, fetcher };
}

describe('a single-owner chunk stamped elsewhere, sent to a Bee node', () => {
  it("goes to Bee's single-owner chunk route with its signature, and the stamp as the envelope header", async () => {
    const { asked, fetcher } = answering(() => new Response('{"reference":"x"}', { status: 201 }));
    await postStampedSoc('https://bee.example.com/', CHUNK, { timeoutMs: 1_000, fetcher });
    expect(asked).toHaveLength(1);
    expect(asked[0].url).toBe(`https://bee.example.com/soc/${CHUNK.owner}/${CHUNK.identifier}?sig=${CHUNK.signature}`);
    expect(asked[0].init.method).toBe('POST');
    const headers = new Headers(asked[0].init.headers);
    expect(headers.get('swarm-postage-stamp')).toBe(CHUNK.stamp);
    expect(headers.get('swarm-postage-batch-id')).toBeNull();
    expect(headers.get('swarm-deferred-upload')).toBe('false');
    expect(headers.get('swarm-tag')).toBeNull();
    expect(asked[0].init.body).toBe(CHUNK.data);
  });

  it('takes the 0x Swarm ID may put in front of the owner and the signature off', async () => {
    const { asked, fetcher } = answering(() => new Response('', { status: 201 }));
    await postStampedSoc(
      'http://localhost:1633',
      { ...CHUNK, owner: `0x${CHUNK.owner}`, signature: `0x${CHUNK.signature}` },
      { timeoutMs: 1_000, fetcher },
    );
    expect(asked[0].url).toBe(`http://localhost:1633/soc/${CHUNK.owner}/${CHUNK.identifier}?sig=${CHUNK.signature}`);
  });

  it("rejects with the node's status and its own words when the node refuses", async () => {
    const { fetcher } = answering(
      () => new Response('{"code":422,"message":"batch not usable yet or does not exist"}', { status: 422 }),
    );
    const error = await postStampedSoc('https://bee.example.com', CHUNK, { timeoutMs: 1_000, fetcher }).catch(
      (caught: unknown) => caught,
    );
    expect(error).toBeInstanceOf(StampedUploadError);
    expect(error).toMatchObject({ status: 422, beeMessage: 'batch not usable yet or does not exist' });
  });

  it('rejects with no status when the node cannot be reached', async () => {
    const fetcher: typeof fetch = async () => {
      throw new TypeError('Failed to fetch');
    };
    const error = await postStampedSoc('https://bee.example.com', CHUNK, { timeoutMs: 1_000, fetcher }).catch(
      (caught: unknown) => caught,
    );
    expect(error).toBeInstanceOf(StampedUploadError);
    expect(error).toMatchObject({ status: null });
  });

  it('gives up after its deadline, and says so', async () => {
    const fetcher: typeof fetch = (_input, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(init.signal?.reason));
      });
    const error = await postStampedSoc('https://bee.example.com', CHUNK, { timeoutMs: 10, fetcher }).catch(
      (caught: unknown) => caught,
    );
    expect(error).toMatchObject({ status: null, timedOut: true });
  });
});
