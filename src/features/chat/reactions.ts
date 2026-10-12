import type { MessageData } from '@solarpunkltd/swarm-chat-js';

export interface ReactionSummary {
  emoji: string;
  count: number;
  hasUserReacted: boolean;
}

/** Message id to the reactions shown under that message, in the order each emoji was first used. */
export type ReactionsByMessage = Record<string, ReactionSummary[]>;

/**
 * A reaction is a message of its own, and sending the same emoji again takes it back, so a person's
 * reaction stands while they have sent it an odd number of times. People are told apart by address,
 * because anyone may choose any name.
 */
export function groupReactions(reactions: MessageData[], ownAddress: string | null): ReactionsByMessage {
  const sent = new Map<string, Map<string, Map<string, number>>>();

  for (const { targetMessageId, message: emoji, address } of reactions) {
    if (!targetMessageId) {
      continue;
    }
    const byEmoji = sent.get(targetMessageId) ?? new Map<string, Map<string, number>>();
    const byAddress = byEmoji.get(emoji) ?? new Map<string, number>();
    byAddress.set(address, (byAddress.get(address) ?? 0) + 1);
    byEmoji.set(emoji, byAddress);
    sent.set(targetMessageId, byEmoji);
  }

  const result: ReactionsByMessage = {};
  for (const [targetId, byEmoji] of sent) {
    const summaries: ReactionSummary[] = [];
    for (const [emoji, byAddress] of byEmoji) {
      const standing = [...byAddress].filter(([, times]) => times % 2 === 1).map(([address]) => address);
      if (standing.length > 0) {
        summaries.push({
          emoji,
          count: standing.length,
          hasUserReacted: ownAddress !== null && standing.includes(ownAddress),
        });
      }
    }
    if (summaries.length > 0) {
      result[targetId] = summaries;
    }
  }
  return result;
}
