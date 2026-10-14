import { MessageVia } from '@solarpunkltd/swarm-chat-js';
import { describe, expect, it } from 'vitest';

import {
  CHAT_STAMP_STORAGE_KEY,
  GATEWAY_PAYS,
  loadChatStampChoice,
  saveChatStampChoice,
} from '../../src/features/chat/stamp/chatStampChoice';

function memory(entries: Record<string, string> = {}) {
  const map = new Map(Object.entries(entries));
  return {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => void map.set(key, value),
    removeItem: (key: string) => void map.delete(key),
    map,
  };
}

describe('who pays for chat messages, as this browser keeps it', () => {
  it('is the gateway, with no own feed, until the viewer picks otherwise', () => {
    expect(GATEWAY_PAYS).toEqual({ payWith: MessageVia.GATEWAY, ownFeed: false });
    expect(loadChatStampChoice(memory())).toEqual(GATEWAY_PAYS);
  });

  it('keeps my stamp and the own feed across a reload', () => {
    const storage = memory();
    saveChatStampChoice({ payWith: MessageVia.OWN_STAMP, ownFeed: true }, storage);
    expect(loadChatStampChoice(storage)).toEqual({ payWith: MessageVia.OWN_STAMP, ownFeed: true });
  });

  it('reads anything else it finds there as the gateway paying', () => {
    for (const saved of ['not json', '{"payWith":"someone-else","ownFeed":true}', '{"payWith":"own-stamp"}', '[]']) {
      expect(loadChatStampChoice(memory({ [CHAT_STAMP_STORAGE_KEY]: saved }))).toEqual(GATEWAY_PAYS);
    }
  });

  it('holds for the visit when the browser refuses its storage', () => {
    expect(loadChatStampChoice(null)).toEqual(GATEWAY_PAYS);
    expect(() => saveChatStampChoice({ payWith: MessageVia.OWN_STAMP, ownFeed: false }, null)).not.toThrow();
  });
});
