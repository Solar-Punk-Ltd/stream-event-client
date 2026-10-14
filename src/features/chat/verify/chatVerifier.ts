import { createMessageVerifier, type MessageVerifier } from './messageVerifier';
import { pageScope } from './verdicts';
import VerifyWorker from './verify.worker?worker';

let shared: MessageVerifier | null = null;

/** The page's one verifier, its worker started the first time a chat asks, and kept while the page is open. */
export function chatVerifier(): MessageVerifier {
  shared ??= createMessageVerifier(new VerifyWorker(), pageScope(location));
  return shared;
}
