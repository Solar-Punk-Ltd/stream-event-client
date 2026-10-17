import type { MessageVia } from '@solarpunkltd/swarm-chat-js';

/** A message an actor sent, with who should have paid for it, which `expect chat-feed` finds in the feed. */
export interface Sent {
  actor: string;
  text: string;
  via: MessageVia;
  /** Sent as a guest, so it carries no Swarm ID binding. */
  guest?: boolean;
  /** For a send on the sender's own stamp, the drive the sender picked for the site, which it must spend. */
  drive?: string;
}

/** One entry of the chat feed as a reader checks it. */
export type FeedEntry =
  | {
      index: number;
      ok: true;
      text: string;
      via: MessageVia;
      account: string | null;
      /** The wallet a verified wallet link in the message names, when it carries one. */
      wallet?: string | null;
      /** The sender's chat address, which is site-specific, so two sites of one account never share it. */
      addr: string;
    }
  | {
      index: number;
      ok: false;
      reason: string;
      /** The message's text when the entry parsed but failed a reader's check, so a check can tell no copy got in. */
      text?: string;
    };

/**
 * What is wrong with the chat feed against what the run sent, one line each, none when it holds them all. Each sent
 * text must carry the run id, so a message an earlier run on the same stack left cannot stand in for this run's.
 */
export function chatFeedProblems(entries: FeedEntry[], sent: Sent[], runId: string): string[] {
  if (!sent.length) return ['the run sent no message, so the feed proves nothing'];
  const problems: string[] = [];
  for (const message of sent) {
    if (!message.text.includes(runId)) {
      problems.push(`"${message.text}" does not carry the run id, so an earlier run could have left it`);
      continue;
    }
    const found = entries.find((entry) => entry.ok && entry.text === message.text);
    if (!found?.ok) problems.push(`the chat feed does not hold "${message.text}"`);
    else if (!message.guest && !found.account) problems.push(`"${message.text}" carries no Swarm ID binding`);
    else if (found.via !== message.via) {
      problems.push(`"${message.text}" says it was paid ${found.via}, not ${message.via}`);
    }
  }
  return problems;
}
