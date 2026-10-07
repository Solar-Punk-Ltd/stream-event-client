import { Bee, Identifier, PrivateKey } from '@ethersphere/bee-js';

/**
 * A batch id for a gateway that stamps what is written through it and ignores the one it is sent.
 * Bee refuses a write with no batch id at all, so something well formed has to go. The value the
 * chat library sends, so a gateway that recognises it keeps doing so.
 */
export const GATEWAY_STAMPS_ITSELF = '0123456789abcdef'.repeat(4);

export interface GsocWriteOptions {
  /** The Bee API the write goes to, the event's chat write gateway: an address, or a path on this site. */
  readonly url: string;
  /** The mined key every sender signs inbox writes with, 64 hex digits. */
  readonly gsocKey: string;
  /** The inbox's identifier string, which the chat server listens on. */
  readonly gsocTopic: string;
  readonly timeoutMs: number;
  /** The batch a write is stamped with. {@link GATEWAY_STAMPS_ITSELF} for a gateway that stamps writes. */
  readonly stamp?: string;
  /** The page's own origin, which a path on this site is resolved against. Read from the page when absent. */
  readonly pageOrigin?: string;
}

function currentPageOrigin(): string {
  return typeof location === 'undefined' ? 'http://localhost' : location.origin;
}

/**
 * One message's bytes written to the chat's inbox, a GSOC address shared by every chat, exactly as
 * the chat library writes it: signed with the mined key, never deferred and never tagged, so each
 * write is pushed at once and two different messages never collide. Rejects when the write did not
 * reach the node.
 */
export function beeGsocWrite(options: GsocWriteOptions): (payload: Uint8Array) => Promise<void> {
  // bee-js takes only a whole address, so a path on this site such as `/chat-write` is made one, as
  // the reads' provider does, rather than refused when the chat starts.
  const bee = new Bee(new URL(options.url, options.pageOrigin ?? currentPageOrigin()).href.replace(/\/+$/, ''));
  const key = new PrivateKey(options.gsocKey);
  const identifier = Identifier.fromString(options.gsocTopic);
  const stamp = options.stamp ?? GATEWAY_STAMPS_ITSELF;
  return async (payload) => {
    await bee.messaging.gsocSend(
      stamp,
      key,
      identifier,
      payload,
      { deferred: false },
      { signal: AbortSignal.timeout(options.timeoutMs) },
    );
  };
}
