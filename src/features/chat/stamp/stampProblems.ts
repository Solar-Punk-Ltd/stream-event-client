import { StampedUploadError } from '@/swarm/providers/bee-http/stampedSocUpload';
import { Weeb3PushError } from '@/swarm/providers/weeb-3/weeb3Push';

/**
 * Why a message on the viewer's own stamp did not go out, in words the message shows. `final` is a refusal a resend
 * cannot mend, so the message fails at once and is tried again only when the viewer asks. Anything else the chat
 * resends on its own, on the same stamp and through the same node.
 */
export interface SendProblem {
  readonly text: string;
  readonly final: boolean;
}

export const NOT_SIGNED_IN = 'Sign in with Swarm ID to send on your stamp.';
export const SIGNED_OUT = 'Swarm ID signed you out. Sign in again to send on your stamp.';
export const NO_SITE_STAMP = 'Swarm ID has given this site no stamp.';
export const SUBSIDISED = 'Swarm ID pays through a gateway for this site, so it has no stamp of yours to use.';
export const STAMP_RAN_OUT = 'Your stamp ran out.';
export const STAMP_NOT_USABLE = 'Your stamp is not usable yet.';
export const SITE_SHARE_USED = 'This site has used all of your stamp that Swarm ID lets it use.';
const TOO_FAST = 'Swarm ID stamps only so many messages a minute for this site.';
const SESSION_CHECKING = 'Swarm ID is still checking your session.';
const STAMP_BUSY = 'Your stamp is busy on another device or tab.';
const NO_ANSWER = 'Swarm ID did not answer.';
const NOT_STAMPED = 'Swarm ID could not stamp it.';
const REFUSED_BY_ID = 'Swarm ID refused to stamp this message.';

const refused = (text: string): SendProblem => ({ text, final: true });
const retried = (text: string): SendProblem => ({ text, final: false });

/** What a refusal of the library's `stampChunk` means for the message, read from its `code` and `reason`. */
export function stampRefusal(error: unknown): SendProblem {
  const { code, reason } = (typeof error === 'object' && error !== null ? error : {}) as {
    code?: unknown;
    reason?: unknown;
  };
  switch (code) {
    case 'not-authenticated':
      return refused(SIGNED_OUT);
    case 'upload-unavailable':
      switch (reason) {
        case 'no-stamp':
          return refused(NO_SITE_STAMP);
        case 'subsidised':
          return refused(SUBSIDISED);
        case 'stamp-expired':
          return refused(STAMP_RAN_OUT);
        case 'stamp-not-usable':
          return refused(STAMP_NOT_USABLE);
        case 'app-stamp-count':
        case 'app-bucket-share':
        case 'app-slice-full':
          return refused(SITE_SHARE_USED);
        case 'app-stamp-rate':
          return retried(TOO_FAST);
        case 'session-unconfirmed':
          return retried(SESSION_CHECKING);
        case 'stamper-failed':
          return retried(NOT_STAMPED);
        default:
          return refused(REFUSED_BY_ID);
      }
    case 'invalid-request':
    case 'invalid-state':
      return refused(REFUSED_BY_ID);
    case 'partition-contended':
    case 'lease-lost':
      return retried(STAMP_BUSY);
    case 'timeout':
      return retried(NO_ANSWER);
    default:
      return retried(NOT_STAMPED);
  }
}

const TOO_MANY_REQUESTS = 429;
const FIRST_SERVER_ERROR = 500;

const WEEB3_NO_ANSWER =
  'Weeb3 did not confirm it within a minute. It gives no answer for a stamp it will not take, so it is not sent again by itself.';
const WEEB3_NOT_RUNNING = 'The Swarm node in this browser is not running.';
const STAMP_WRONG_SIZE = 'Swarm ID gave a stamp of the wrong size.';

/**
 * What a failed push through the node in this browser means for the message. weeb-3 answers a stamp it will not take
 * with silence, so a push that ran out its deadline is most likely refused, and a resend on the same stamp would wait
 * the whole deadline again: it fails at once. A node not running is started again by the next push, so that resends.
 */
function weeb3Problem(error: Weeb3PushError): SendProblem {
  switch (error.reason) {
    case 'deadline':
      return refused(WEEB3_NO_ANSWER);
    case 'refused':
      return refused(`Weeb3 refused it${error.detail ? ` (${error.detail})` : ''}.`);
    case 'node':
      return retried(WEEB3_NOT_RUNNING);
    case 'stamp-size':
      return refused(STAMP_WRONG_SIZE);
  }
}

/** What a failed send, to the viewer's own Bee node or through the node in this browser, means for the message. */
export function uploadProblem(error: unknown): SendProblem {
  if (error instanceof Weeb3PushError) {
    return weeb3Problem(error);
  }
  if (!(error instanceof StampedUploadError) || error.status === null) {
    return retried(
      error instanceof StampedUploadError && error.timedOut
        ? 'Your Bee node did not answer in time.'
        : 'Your Bee node cannot be reached.',
    );
  }
  const { status, beeMessage } = error;
  if (status === TOO_MANY_REQUESTS || status >= FIRST_SERVER_ERROR) {
    return retried(`Your Bee node answered with an error (HTTP ${status}).`);
  }
  return refused(`Your Bee node refused it (HTTP ${status}${beeMessage ? `: ${beeMessage}` : ''}).`);
}
