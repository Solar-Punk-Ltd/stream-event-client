import { type Verdict, type VerifiedBatch, verifyBatch, type VerifyRequest, type VerifyScope } from './verdicts';

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
}

/** The same message always serializes the same, and any change to it, a tampered one included, gives another key. */
function keyOf(signedMessage: unknown): string {
  return JSON.stringify(signedMessage) ?? '';
}

interface PendingBatch {
  readonly request: VerifyRequest;
  readonly answers: ReadonlyArray<(verdict: Verdict) => void>;
}

/** Answers a batch with the worker's own check, run on the page's thread. */
function answerHere({ request, answers }: PendingBatch): void {
  const { verdicts } = verifyBatch(request);
  answers.forEach((answer, at) => answer(verdicts[at]!));
}

/**
 * Checks signed messages in a worker. Messages asked for in one turn of the page's event loop are posted together, in
 * batches of {@link VERIFY_BATCH_SIZE}, and a message seen before is answered from its first verdict.
 *
 * A worker that cannot start, errs, or cannot carry a batch either way is left for good, and the same check runs on
 * the page's thread instead, for the batches it held and every one after. Every message is still checked, and none is
 * shown unchecked.
 */
export function createMessageVerifier(start: () => VerifierPort, scope: VerifyScope): MessageVerifier {
  const verdicts = new Map<string, Promise<Verdict>>();
  const waiting = new Map<number, PendingBatch>();
  let queue: Array<{ message: unknown; answer: (verdict: Verdict) => void }> = [];
  let nextBatch = 0;
  let port: VerifierPort | null = null;

  const leaveWorker = () => {
    port = null;
    const held = [...waiting.values()];
    waiting.clear();
    held.forEach(answerHere);
  };

  try {
    port = start();
    port.onmessage = ({ data }) => {
      const batch = waiting.get(data.batch);
      if (!batch) {
        return;
      }
      waiting.delete(data.batch);
      if (data.verdicts.length === batch.answers.length) {
        batch.answers.forEach((answer, at) => answer(data.verdicts[at]!));
      } else {
        answerHere(batch);
      }
    };
    port.onerror = leaveWorker;
    port.onmessageerror = leaveWorker;
  } catch {
    port = null;
  }

  const flush = () => {
    const pending = queue;
    queue = [];
    for (let at = 0; at < pending.length; at += VERIFY_BATCH_SIZE) {
      const slice = pending.slice(at, at + VERIFY_BATCH_SIZE);
      const batch: PendingBatch = {
        request: { ...scope, batch: nextBatch++, messages: slice.map(({ message }) => message) },
        answers: slice.map(({ answer }) => answer),
      };
      if (!port) {
        answerHere(batch);
        continue;
      }
      waiting.set(batch.request.batch, batch);
      try {
        port.postMessage(batch.request);
      } catch {
        leaveWorker();
      }
    }
  };

  return {
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
