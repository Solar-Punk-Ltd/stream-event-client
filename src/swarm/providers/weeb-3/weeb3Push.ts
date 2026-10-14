import { Bytes, Identifier } from '@ethersphere/bee-js';

import { singleOwnerChunkAddress } from '../../singleOwnerChunk';
import type { StampedSoc } from '../bee-http/stampedSocUpload';
import type { Weeb3RuntimeView } from './weeb3Provider';
import { sharedWeeb3Runtime } from './weeb3Runtime';

/**
 * How long a push through weeb-3 may take before it counts as refused. Measured pushes took 6.6 s and 14.6 s, and one
 * with a stamp from the wrong key never answered in 90 s, so weeb-3 has no answer for a refusal but silence.
 */
export const WEEB3_PUSH_DEADLINE_MS = 60_000;

const SUCCESS = /success/i;

/** A postage stamp: batch id, chunk index, timestamp and the batch owner's signature. */
const STAMP_BYTES = 113;
const STAMP_HEX = new RegExp(`^(?:0x)?[0-9a-f]{${STAMP_BYTES * 2}}$`, 'i');

/**
 * Why a push through weeb-3 did not go out: no answer by the deadline, a refusal it named, no node to push with, or a
 * stamp that is not one, which is never handed to the node.
 */
type Weeb3PushFailure = 'deadline' | 'refused' | 'node' | 'stamp-size';

export class Weeb3PushError extends Error {
  constructor(
    readonly reason: Weeb3PushFailure,
    readonly detail: string | null,
    options?: { cause?: unknown },
  ) {
    super(
      reason === 'deadline'
        ? `the node in this browser did not confirm the push in ${WEEB3_PUSH_DEADLINE_MS / 1000} s`
        : reason === 'node'
          ? 'the node in this browser is not running'
          : reason === 'stamp-size'
            ? `the stamp is not ${STAMP_BYTES} bytes`
            : `the node in this browser refused the push${detail ? `: ${detail}` : ''}`,
      options,
    );
    this.name = 'Weeb3PushError';
  }
}

interface PushOptions {
  /** Injected by tests. The page's one node otherwise. */
  readonly runtime?: Weeb3RuntimeView;
}

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

/**
 * Sends a single-owner chunk signed and stamped elsewhere, such as in Swarm ID's frame, to the network through the
 * node in this browser, with `postPushChunk`. The node is held for the push, started if nothing held it, and let go
 * after. Nothing else is asked to send it, whatever happens.
 *
 * @throws Weeb3PushError when the stamp is not {@link STAMP_BYTES} bytes, the node cannot run, refuses the chunk, or has not answered by
 *   {@link WEEB3_PUSH_DEADLINE_MS}.
 */
export async function pushStampedSocThroughWeeb3(chunk: StampedSoc, options: PushOptions = {}): Promise<void> {
  if (!STAMP_HEX.test(chunk.stamp)) {
    throw new Weeb3PushError('stamp-size', null);
  }
  const runtime = options.runtime ?? sharedWeeb3Runtime();
  const identifier = new Identifier(chunk.identifier);
  const address = new Bytes(singleOwnerChunkAddress(identifier, chunk.owner)).toUint8Array();
  const data = Bytes.concat(identifier.toUint8Array(), new Bytes(chunk.signature).toUint8Array(), chunk.data);
  const stamp = new Bytes(chunk.stamp).toUint8Array();
  try {
    let node;
    try {
      await runtime.acquire();
      node = await runtime.whenReady();
    } catch (error) {
      throw new Weeb3PushError('node', null, { cause: error });
    }
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Weeb3PushError('deadline', null)), WEEB3_PUSH_DEADLINE_MS);
    });
    let answer: string;
    try {
      answer = await Promise.race([
        node.postPushChunk(data, true, address, stamp).catch((error: unknown) => {
          throw new Weeb3PushError('refused', messageOf(error), { cause: error });
        }),
        deadline,
      ]);
    } finally {
      clearTimeout(timer);
    }
    if (!SUCCESS.test(answer)) {
      throw new Weeb3PushError('refused', answer);
    }
  } finally {
    runtime.release();
  }
}
