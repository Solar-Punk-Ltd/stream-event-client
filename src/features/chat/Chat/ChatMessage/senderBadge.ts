import type { ChatIdentity } from '@solarpunkltd/swarm-chat-js';

/** What a message's badge says about its sender, in the words of the badge and of its details. */
export interface SenderBadge {
  /** The badge's accessible name and the details card's title. */
  readonly name: string;
  /** The details card's Identity line. */
  readonly line: string;
  readonly isSwarmId: boolean;
}

const GUEST: SenderBadge = { name: 'Guest', line: 'Guest, a key this browser keeps', isSwarmId: false };
const SWARM_ID: SenderBadge = { name: 'Swarm ID', line: 'Swarm ID, confirmed for this chat address', isSwarmId: true };

export function senderBadge(identity: ChatIdentity | null): SenderBadge {
  return identity ? SWARM_ID : GUEST;
}

/** The stamp's short name, shown as its title. */
export const OWN_STAMP_TITLE = 'Own stamp';
export const OWN_STAMP_LABEL = 'Sent with their own stamp, show details';

/** The badge button's accessible name, which says what pressing it does. */
export function badgeLabel(badge: SenderBadge): string {
  return `${badge.name}, show details`;
}
