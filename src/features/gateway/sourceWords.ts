/**
 * The words of the Sources screen that are not a check's sentence: labels, hints and the one status
 * line of a tested source. Short on purpose, since the screen is a setting rather than a report, and the
 * full sentences of a failure stay in `checkSentences` behind each failure's "How to fix".
 */
import type { BeeNodeAccess } from '@/swarm/beeNodeAccess';
import type { SwarmFeature } from '@/swarm/client';
import type { SwarmSettings } from '@/swarm/settings';
import { SOURCE_TYPE_KIND, type SourceType } from '@/swarm/sources';

import type { Help } from './checkSentences';
import type { CheckName, CheckOutcome, CheckResult } from './providerTest';

export const PART_LABELS: Readonly<Record<SwarmFeature, string>> = {
  player: 'Video',
  'stream-list': 'Stream list',
  previews: 'Previews',
  chat: 'Chat',
};

export const BADGE_LABELS: Readonly<Record<CheckName, string>> = {
  connection: 'Connection',
  'stream-list': 'Stream list',
  player: 'Video',
  previews: 'Previews',
  thumbnails: 'Pictures',
  chat: 'Chat',
};

export const OUTCOME_WORDS: Readonly<Record<CheckOutcome, string>> = {
  passed: 'passed',
  failed: 'failed',
  skipped: 'not applicable',
};

export const TYPE_GROUP_LABELS: Readonly<Record<SourceType, string>> = {
  gateway: 'Gateways',
  'bee-node': 'Bee nodes',
};

export const TYPE_LABELS: Readonly<Record<SourceType, string>> = {
  gateway: 'Gateway',
  'bee-node': 'Bee node',
};

/** A hint in an empty name, worded so it cannot be read as a name already filled in. */
export const NAME_PLACEHOLDERS: Readonly<Record<SourceType, string>> = {
  gateway: 'My gateway',
  'bee-node': 'Home node',
};

export const ADDRESS_PLACEHOLDERS: Readonly<Record<SourceType, string>> = {
  gateway: 'https://gateway.example.com',
  'bee-node': 'http://localhost:1633',
};

/** What the chat reads from unless a viewer picks another source for it. */
export const CHAT_SERVICE_NAME = 'Event chat service';

export const CHAT_SEND_NOTE = "Messages go through the event's chat service";

export const UNLINKED_NOTE = 'Video and stream list differ. Timing may slip.';

const BEE_NODE_HINTS: Readonly<Record<BeeNodeAccess, string>> = {
  off: 'On this computer, such as Swarm Desktop',
  https: 'On this computer, or another machine at an https address',
  'https-and-local-http': 'On this computer, another machine at an https address, or your network in Chrome or Edge',
};

/** The one line under an address a viewer types, which says where the source may be. */
export function addressHint(type: SourceType, access: BeeNodeAccess): string {
  return type === 'bee-node' ? BEE_NODE_HINTS[access] : 'An https address';
}

/**
 * Why a viewer cannot add a source of this type here, or null when they can. A gateway elsewhere is an
 * https address, which a site that allows only Bee nodes on this computer refuses to load.
 */
export function unavailableTypeReason(
  type: SourceType,
  access: BeeNodeAccess,
  kinds: SwarmSettings['kinds'],
): string | null {
  if (!kinds.includes(SOURCE_TYPE_KIND[type])) {
    return 'Not offered on this site';
  }
  return type === 'gateway' && access === 'off' ? 'Not allowed on this site' : null;
}

function listed(words: readonly string[]): string {
  return words.length < 2 ? words.join('') : `${words.slice(0, -1).join(', ')} and ${words[words.length - 1]}`;
}

/** Checks named as a phrase that opens a sentence: "Stream list, video and pictures". */
function checksPhrase(checks: readonly CheckName[]): string {
  return listed(checks.map((check, at) => (at === 0 ? BADGE_LABELS[check] : BADGE_LABELS[check].toLowerCase())));
}

/** A tested source's state in one line: that it works, or what failed. */
export function testStatusLine(results: readonly CheckResult[]): string {
  const failed = results.filter(({ outcome }) => outcome === 'failed').map(({ check }) => check);
  return failed.length === 0 ? 'Everything tested works' : `${checksPhrase(failed)} failed`;
}

/** One fix behind How to fix, and the failed checks it applies to. */
export interface FixGroup {
  readonly heading: string;
  readonly sentence: string;
  readonly help?: Help;
}

/**
 * The failures of a Test as the fixes to show, each once: checks that failed with the same sentence
 * and the same steps share one fix, headed by every part it applies to, in the order the checks run.
 */
export function fixGroups(results: readonly CheckResult[]): FixGroup[] {
  const groups = new Map<string, { checks: CheckName[]; sentence: string; help?: Help }>();
  for (const { check, outcome, sentence, help } of results) {
    if (outcome !== 'failed') {
      continue;
    }
    const key = JSON.stringify([sentence, help ?? null]);
    const group = groups.get(key);
    if (group) {
      group.checks.push(check);
    } else {
      groups.set(key, { checks: [check], sentence, help });
    }
  }
  return [...groups.values()].map(({ checks, sentence, help }) => ({
    heading: checksPhrase(checks),
    sentence,
    ...(help === undefined ? {} : { help }),
  }));
}
