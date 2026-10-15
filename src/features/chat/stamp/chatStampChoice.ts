import { MessageVia } from '@solarpunkltd/swarm-chat-js/message';
import { z } from 'zod';

import { type BrowserStorage, browserStorage, readStored, writeStored } from '@/app/browserStorage';

const CHAT_STAMP_STORAGE_PREFIX = 'stream-event-client:chat-stamp:';

/** One entry per account, named by its chat address on this site, so another account here starts on the gateway. */
export function chatStampStorageKey(chatAddress: string): string {
  return `${CHAT_STAMP_STORAGE_PREFIX}${chatAddress.toLowerCase()}`;
}

/** Who the viewer picked to pay for their chat messages. On their own stamp each also gets a copy in their own feed. */
export interface ChatStampChoice {
  readonly payWith: MessageVia;
}

/** Everyone starts here, and a signed-out viewer is always here. */
export const GATEWAY_PAYS: ChatStampChoice = { payWith: MessageVia.GATEWAY };

const storedChoiceSchema = z.object({
  payWith: z.enum([MessageVia.GATEWAY, MessageVia.OWN_STAMP]),
});

/** What this account picked before in this browser. Anything else written under its key reads as the gateway paying. */
export function loadChatStampChoice(
  chatAddress: string,
  storage: BrowserStorage | null = browserStorage(),
): ChatStampChoice {
  const saved = readStored(storage, chatStampStorageKey(chatAddress));
  if (saved === null) {
    return GATEWAY_PAYS;
  }
  try {
    const parsed = storedChoiceSchema.safeParse(JSON.parse(saved));
    return parsed.success ? parsed.data : GATEWAY_PAYS;
  } catch {
    return GATEWAY_PAYS;
  }
}

export function saveChatStampChoice(
  chatAddress: string,
  choice: ChatStampChoice,
  storage: BrowserStorage | null = browserStorage(),
): void {
  writeStored(storage, chatStampStorageKey(chatAddress), JSON.stringify(choice));
}
