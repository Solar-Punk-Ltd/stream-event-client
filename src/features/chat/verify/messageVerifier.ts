import { UNCHECKED, type Verdict, type VerifiedBatch, type VerifyRequest, type VerifyScope } from './verdicts';

/**
 * How many messages go to the worker at once. A history file arrives as one burst of events, and each batch is
 * answered as soon as it is checked, so the first messages show while the rest are still being checked.
 */
export const VERIFY_BATCH_SIZE = 25;

/** The part of a Web Worker the verifier uses, so a test can answer in its place. */
export interface VerifierPort {
  postMessage(request: VerifyRequest): void;
  onmessage: ((event: MessageEvent<VerifiedBatch>) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
  onmessageerror: ((event: MessageEvent) => void) | null;
}

export interface MessageVerifier {
  /** Whether `signedMessage` passed the library's checks for this page, and who signed it. Never rejects. */
  verify(signedMessage: unknown): Promise<Verdict>;
  /** True once its worker failed, after which every message is turned away as unchecked. */
  readonly failed: boolean;
}

const UNCHECKED_VERDICT: Verdict = { ok: false, reason: UNCHECKED };

/** The same message always serializes the same, and any change to it, a tampered one included, gives another key. */
function keyOf(signedMessage: unknown): string {
  return JSON.stringify(signedMessage) ?? '';
}

/**
 * Checks signed messages in a worker. Messages asked for in one turn of the page's event loop are posted together, in
 * batches of {@link VERIFY_BATCH_SIZE}, and a message seen before is answered from its first verdict.
 */
export function createMessageVerifier(port: VerifierPort, scope: VerifyScope): MessageVerifier {
  const verdicts = new Map<string, Promise<Verdict>>();
  const answers = new Map<number, Array<(verdict: Verdict) => void>>();
  let queue: Array<{ message: unknown; answer: (verdict: Verdict) => void }> = [];
  let nextBatch = 0;
  let failed = false;

  const failAll = () => {
    failed = true;
    for (const waiting of answers.values()) {
      for (const answer of waiting) {
        answer(UNCHECKED_VERDICT);
      }
    }
    answers.clear();
  };

  port.onmessage = ({ data }) => {
    const waiting = answers.get(data.batch);
    answers.delete(data.batch);
    waiting?.forEach((answer, at) => answer(data.verdicts[at] ?? UNCHECKED_VERDICT));
  };
  port.onerror = failAll;
  port.onmessageerror = failAll;

  const flush = () => {
    const pending = queue;
    queue = [];
    for (let start = 0; start < pending.length; start += VERIFY_BATCH_SIZE) {
      const slice = pending.slice(start, start + VERIFY_BATCH_SIZE);
      if (failed) {
        slice.forEach(({ answer }) => answer(UNCHECKED_VERDICT));
        continue;
      }
      const batch = nextBatch++;
      answers.set(
        batch,
        slice.map(({ answer }) => answer),
      );
      try {
        port.postMessage({ ...scope, batch, messages: slice.map(({ message }) => message) });
      } catch {
        failAll();
      }
    }
  };

  return {
    get failed() {
      return failed;
    },
    verify(signedMessage) {
      const key = keyOf(signedMessage);
      const known = verdicts.get(key);
      if (known) {
        return known;
      }
      const verdict = new Promise<Verdict>((answer) => {
        if (queue.length === 0) {
          queueMicrotask(flush);
        }
        queue.push({ message: signedMessage, answer });
      });
      verdicts.set(key, verdict);
      return verdict;
    },
  };
}

/** A verifier for a worker that could not be started, which turns every message away. */
const FAILED_VERIFIER: MessageVerifier = {
  verify: () => Promise.resolve(UNCHECKED_VERDICT),
  failed: true,
};

/** How many times a failed worker is started again before the page gives up on checking messages. */
const RESTARTS = 1;

/**
 * The page's verifier, started on the first call and started again, at most {@link RESTARTS} times, on the first call
 * after its worker failed. A worker that throws as it starts counts as one that failed.
 */
export function rebuildingVerifier(start: () => VerifierPort, scope: () => VerifyScope): () => MessageVerifier {
  let current: MessageVerifier | null = null;
  let starts = 0;
  return () => {
    if (current && (!current.failed || starts > RESTARTS)) {
      return current;
    }
    starts++;
    try {
      current = createMessageVerifier(start(), scope());
    } catch {
      current = FAILED_VERIFIER;
    }
    return current;
  };
}
