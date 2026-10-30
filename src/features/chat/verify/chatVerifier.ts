import { createMessageVerifier, type MessageVerifier } from './messageVerifier';
import { pageScope } from './verdicts';
import VerifyWorker from './verify.worker?worker';

let otherSites: readonly string[] = [];
let shared: MessageVerifier | null = null;

/**
 * Names the other sites that serve this chat, whose Swarm ID bindings pass beside the page's own. Called once the
 * config is read, before anything renders, because the verifier keeps the sites it was started with.
 */
export function setChatSiteOrigins(siteOrigins: readonly string[]): void {
  otherSites = siteOrigins;
}

/** The page's one verifier, its worker started the first time a chat asks, and kept while the page is open. */
export function chatVerifier(): MessageVerifier {
  shared ??= createMessageVerifier(() => new VerifyWorker(), pageScope(location, otherSites));
  return shared;
}
