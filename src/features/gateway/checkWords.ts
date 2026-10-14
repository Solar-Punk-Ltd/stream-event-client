/**
 * What the checks before adding a source say: each check's line, and for a failure what is wrong and what to fix,
 * one short sentence each, in the design's wording. Kept apart from the checks so every sentence has a test.
 */
import type { SwarmAnswer } from '@/swarm/answers';
import type { NotReadyReason } from '@/swarm/provider';
import type { SourceType } from '@/swarm/sources';

import { corsHelp, type Help, LOCAL_NETWORK_HELP } from './checkSentences';

/** Every check a source can be put through. */
export type CheckStep = 'https' | 'reach' | 'cors' | 'version' | 'chunk' | 'bytes' | 'feed' | 'start' | 'peers';

/** The checks of each kind of source, in the order they run. */
export const CHECK_STEPS: Readonly<Record<SourceType, readonly CheckStep[]>> = {
  gateway: ['https', 'cors', 'version', 'chunk', 'bytes', 'feed'],
  'bee-node': ['reach', 'cors', 'version', 'chunk', 'bytes', 'feed'],
  'weeb-3': ['start', 'peers', 'chunk', 'bytes', 'feed'],
};

/** How many peers the node in this browser connects to before its reads are checked. */
export const WEEB3_CHECK_PEERS = 20;

const LINES: Readonly<Record<CheckStep, string>> = {
  https: 'Answers over https',
  reach: 'Answers, on this computer or at an https address',
  cors: 'Allows this site (CORS)',
  version: 'Bee 2.6 or later',
  chunk: 'Reads a chunk',
  bytes: 'Reads bytes',
  feed: "Reads this event's stream list",
  start: 'Node started',
  peers: `Connected to ${WEEB3_CHECK_PEERS} peers`,
};

/** A check's line as the list shows it. A Bee node of the viewer's own must also be ready, which a gateway is not asked. */
export function checkLine(type: SourceType, step: CheckStep): string {
  return type === 'bee-node' && step === 'version' ? 'Bee 2.6 or later, ready' : LINES[step];
}

/** What is wrong, and what to do about it, with the steps of a fix that takes more than a sentence. */
export interface CheckFailure {
  readonly reason: string;
  readonly fix: string;
  readonly help?: Help;
}

const seconds = (ms: number) => Math.max(1, Math.round(ms / 1000));

export const NOT_HTTPS: CheckFailure = {
  reason: 'It is not an https address.',
  fix: 'A gateway is added at its https address, starting with https://.',
};

export const NOTHING_ANSWERS: CheckFailure = {
  reason: 'Nothing answers at this address.',
  fix: 'Check the address, and that the node is running. The Bee API is usually on port 1633.',
};

export const noAnswerFor = (ms: number): CheckFailure => ({
  reason: `No answer for ${seconds(ms)} s.`,
  fix: 'It may be busy or still starting. Test again in a minute.',
});

export const LOCAL_NETWORK_BLOCKED: CheckFailure = {
  reason: 'Your browser keeps this site from reaching this computer.',
  fix: 'Allow this site to reach your local network, then test again.',
  help: LOCAL_NETWORK_HELP,
};

export const MIXED_CONTENT_BLOCKED: CheckFailure = {
  reason: 'Your browser blocks plain http from a site served over https.',
  fix: 'Use the address starting with https://.',
};

/** A source that answered and does not let this page read the answer. Its owner fixes that, the viewer for their own node. */
export function corsRefused(type: SourceType, origin: string): CheckFailure {
  return type === 'bee-node'
    ? {
        reason: 'It does not allow this site (CORS).',
        fix: "Add this site to your node's cors-allowed-origins, then restart the node.",
        help: corsHelp(origin),
      }
    : {
        reason: 'It does not allow this site (CORS).',
        fix: "Its operator has to add this site to Bee's cors-allowed-origins.",
      };
}

export const NOT_BEE: CheckFailure = {
  reason: 'Something answers here, but it is not a Bee node.',
  fix: 'Check the address and the port.',
};

export function notReady(reason: NotReadyReason): CheckFailure {
  switch (reason.kind) {
    case 'too-old':
      return { reason: `It runs Bee ${reason.version}.`, fix: 'Update it to Bee 2.6 or later, then test again.' };
    case 'starting':
      return { reason: 'The node is still starting.', fix: 'Wait a minute, then test again.' };
    case 'no-peers':
      return { reason: 'The node has no peers yet.', fix: 'Wait a minute for it to connect, then test again.' };
  }
}

export const healthRefused = (status: number): CheckFailure => ({
  reason: `Its health answers with an error (HTTP ${status}).`,
  fix: 'Check the address and the port.',
});

/** The version line's note for a gateway that does not say which Bee it runs, which only its operator can change. */
export const VERSION_NOT_STATED = 'not stated';

/** A read that did not give what it asked for, `what` naming it, such as "a chunk". */
export function readFailure(what: string, answer: Exclude<SwarmAnswer, { kind: 'content' }>): CheckFailure {
  switch (answer.kind) {
    case 'not-found':
      return {
        reason: `It could not find ${what} on the network.`,
        fix: 'It may not have it yet. Test again in a minute.',
      };
    case 'rate-limited':
      return { reason: 'It asks to be asked less often.', fix: 'Wait a minute, then test again.' };
    case 'unsupported':
      return { reason: `It cannot read ${what}.`, fix: 'Choose another kind of source.' };
    case 'aborted':
      return { reason: 'The test was stopped.', fix: 'Test again.' };
    case 'unavailable':
      switch (answer.cause.kind) {
        case 'timeout':
          return noAnswerFor(answer.cause.timeoutMs);
        case 'status':
          return {
            reason: `It answers with an error (HTTP ${answer.cause.status}).`,
            fix: 'Test again in a minute, or add another source.',
          };
        case 'network':
          return {
            reason: `It did not answer when asked for ${what}.`,
            fix: 'Test again in a minute, or add another source.',
          };
      }
  }
}

export const NOT_THE_STREAM_LIST: CheckFailure = {
  reason: "It answered, but not with this event's stream list.",
  fix: 'Check the address.',
};

export const NOTHING_TO_READ: CheckFailure = {
  reason: "This event's stream list has nothing to read yet.",
  fix: 'Test again once a stream is listed.',
};

export const NODE_FAILED: CheckFailure = {
  reason: 'The node in this browser did not start.',
  fix: 'Test again to start it once more.',
};

export const tooFewPeers = (peers: number, ms: number): CheckFailure => ({
  reason: `${peers} of ${WEEB3_CHECK_PEERS} peers after ${seconds(ms)} s.`,
  fix: 'Check your network, then test again.',
});
