import { type VerifiedBatch, verifyBatch, type VerifyRequest } from './verdicts';

/** The worker's global as this file uses it. The project's types are the page's, which give `self` a window's shape. */
interface WorkerScope {
  onmessage: ((event: MessageEvent<VerifyRequest>) => void) | null;
  postMessage(answer: VerifiedBatch): void;
}

const scope = self as unknown as WorkerScope;

scope.onmessage = (event) => {
  scope.postMessage(verifyBatch(event.data));
};
