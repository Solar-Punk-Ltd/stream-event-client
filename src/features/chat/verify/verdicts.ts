import { type ChatIdentity, type ChatMessageRefusal, verifyChatMessage } from '@solarpunkltd/swarm-chat-js/message';

/** Which site's Swarm ID bindings a check accepts: this page's own origin. */
export interface VerifyScope {
  readonly origin: string;
  /** True only on a page served over plain http from this machine, where a development build of Swarm ID signs. */
  readonly allowLocalHttp: boolean;
}

/** One batch of signed messages, as the page posts it to the worker. */
export interface VerifyRequest extends VerifyScope {
  readonly batch: number;
  readonly messages: readonly unknown[];
}

/** Set by the page, never by the worker: the worker failed, so nothing was checked and nothing is shown. */
export const UNCHECKED = 'unchecked';

export type Verdict =
  | { readonly ok: true; readonly identity: ChatIdentity | null }
  | { readonly ok: false; readonly reason: ChatMessageRefusal | typeof UNCHECKED };

/** The verdicts of one batch, in the order its messages were posted. */
export interface VerifiedBatch {
  readonly batch: number;
  readonly verdicts: readonly Verdict[];
}

/** The worker's whole job. Runs on the page's thread only in tests, where jsdom has no Web Worker. */
export function verifyBatch({ batch, messages, origin, allowLocalHttp }: VerifyRequest): VerifiedBatch {
  return {
    batch,
    verdicts: messages.map((message): Verdict => {
      const check = verifyChatMessage(message, { origin, allowLocalHttp });
      return check.ok ? { ok: true, identity: check.identity } : { ok: false, reason: check.reason };
    }),
  };
}

const LOCAL_HOSTS: ReadonlySet<string> = new Set(['localhost', '127.0.0.1', '[::1]']);

/** The scope of the page at `location`. */
export function pageScope(location: Pick<Location, 'origin' | 'protocol' | 'hostname'>): VerifyScope {
  return {
    origin: location.origin,
    allowLocalHttp: location.protocol === 'http:' && LOCAL_HOSTS.has(location.hostname),
  };
}
