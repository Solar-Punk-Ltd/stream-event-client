/**
 * The words of the Sources screen that are not a check's sentence: labels, hints and the one status
 * line of a tested source. Short on purpose, since the screen is a setting rather than a report, and the
 * full sentences of a failure stay in `checkSentences` behind each failure's "How to fix".
 */
import type { BeeNodeAccess } from '@/swarm/beeNodeAccess';
import type { SwarmFeature } from '@/swarm/client';
import type { SwarmSettings } from '@/swarm/settings';
import { SOURCE_TYPE_KIND, type SourceType } from '@/swarm/sources';

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

export const ADDRESS_PLACEHOLDERS: Readonly<Record<SourceType, string>> = {
  gateway: 'https://gateway.example.com',
  'bee-node': 'http://localhost:1633',
};

/** What the chat reads from unless a viewer picks another source for it. */
export const CHAT_SERVICE_NAME = 'Event chat service';

export const CHAT_SEND_NOTE = "Messages are always sent through the event's chat service";

export const UNLINKED_NOTE = 'Live timing may slip while video and stream list differ';

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

/** A tested source's state in one line: that it works, or what failed. */
export function testStatusLine(results: readonly CheckResult[]): string {
  const failed = results
    .filter(({ outcome }) => outcome === 'failed')
    .map(({ check }, at) => (at === 0 ? BADGE_LABELS[check] : BADGE_LABELS[check].toLowerCase()));
  return failed.length === 0 ? 'Everything tested works' : `${listed(failed)} failed`;
}
