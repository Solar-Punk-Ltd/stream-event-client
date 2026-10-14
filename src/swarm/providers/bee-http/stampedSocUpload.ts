import { boundedRequest } from '../../boundedRequest';

/** A single-owner chunk signed and stamped somewhere else, such as in Swarm ID's frame, ready to send as it is. */
export interface StampedSoc {
  /** 40 hex digits. */
  readonly owner: string;
  /** 64 hex digits. */
  readonly identifier: string;
  /** 130 hex digits, over the identifier and the wrapped chunk's address. */
  readonly signature: string;
  /** The stamp as Bee's `swarm-postage-stamp` header takes it, hex. */
  readonly stamp: string;
  /** The wrapped chunk: its 8-byte little-endian span, then its payload. */
  readonly data: Uint8Array<ArrayBuffer>;
}

/** A Bee node that did not store the chunk. `status` is null when it never answered. */
export class StampedUploadError extends Error {
  constructor(
    readonly status: number | null,
    readonly beeMessage: string | null,
    readonly timedOut: boolean,
    options?: { cause?: unknown },
  ) {
    super(
      status === null
        ? timedOut
          ? 'the Bee node did not answer in time'
          : 'the Bee node could not be reached'
        : `the Bee node answered ${status}${beeMessage ? `: ${beeMessage}` : ''}`,
      options,
    );
    this.name = 'StampedUploadError';
  }
}

const STORED = 201;
const FIRST_ERROR_STATUS = 400;

const bare = (hex: string) => (hex.startsWith('0x') ? hex.slice(2) : hex).toLowerCase();

function beeMessageOf(body: Uint8Array | null): string | null {
  if (!body) {
    return null;
  }
  try {
    const { message } = JSON.parse(new TextDecoder().decode(body)) as { message?: unknown };
    return typeof message === 'string' && message.trim() ? message.trim() : null;
  } catch {
    return null;
  }
}

interface PostStampedSocOptions {
  readonly timeoutMs: number;
  readonly fetcher?: typeof fetch;
}

/**
 * Sends a chunk stamped elsewhere to a Bee node's `/soc` route, which stores it under the stamp it carries rather than
 * one of the node's own batches. Never deferred and never tagged, so it is pushed at once, as every chat write is.
 *
 * @throws StampedUploadError when the node did not answer 201.
 */
export async function postStampedSoc(
  baseUrl: string,
  chunk: StampedSoc,
  options: PostStampedSocOptions,
): Promise<void> {
  const base = baseUrl.replace(/\/+$/, '');
  const url = `${base}/soc/${bare(chunk.owner)}/${bare(chunk.identifier)}?sig=${bare(chunk.signature)}`;
  const outcome = await boundedRequest(url, {
    fetcher: options.fetcher ?? fetch,
    timeoutMs: options.timeoutMs,
    readsBody: (status) => status >= FIRST_ERROR_STATUS,
    init: {
      method: 'POST',
      headers: {
        'content-type': 'application/octet-stream',
        'swarm-postage-stamp': bare(chunk.stamp),
        'swarm-deferred-upload': 'false',
      },
      body: chunk.data,
    },
  });
  switch (outcome.kind) {
    case 'response':
      if (outcome.response.status !== STORED) {
        throw new StampedUploadError(outcome.response.status, beeMessageOf(outcome.body), false);
      }
      return;
    case 'timed-out':
      throw new StampedUploadError(null, null, true);
    case 'aborted':
      throw new StampedUploadError(null, null, false);
    case 'failed':
      throw new StampedUploadError(null, null, false, { cause: outcome.error });
  }
}
