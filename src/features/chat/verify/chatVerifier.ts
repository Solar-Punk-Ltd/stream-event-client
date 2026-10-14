import { rebuildingVerifier } from './messageVerifier';
import { pageScope } from './verdicts';
import VerifyWorker from './verify.worker?worker';

/** The page's one verifier, its worker started the first time a chat asks, and kept while the page is open. */
export const chatVerifier = rebuildingVerifier(
  () => new VerifyWorker(),
  () => pageScope(location),
);
