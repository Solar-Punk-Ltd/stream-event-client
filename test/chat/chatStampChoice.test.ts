import { MessageVia } from '@solarpunkltd/swarm-chat-js';
import { describe, expect, it } from 'vitest';

import {
  chatStampStorageKey,
  GATEWAY_PAYS,
  loadChatStampChoice,
  saveChatStampChoice,
} from '../../src/features/chat/stamp/chatStampChoice';

const ADA = 'a'.repeat(40);
const BEA = 'b'.repeat(40);

function memory(entries: Record<string, string> = {}) {
  const map = new Map(Object.entries(entries));
  return {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => void map.set(key, value),
    removeItem: (key: string) => void map.delete(key),
    map,
  };
}

describe('who pays for chat messages, as this browser keeps it for each account', () => {
  it('is the gateway until the account picks otherwise', () => {
    expect(GATEWAY_PAYS).toEqual({ payWith: MessageVia.GATEWAY });
    expect(loadChatStampChoice(ADA, memory())).toEqual(GATEWAY_PAYS);
  });

  it('keeps my stamp across a reload, for that account alone', () => {
    const storage = memory();
    saveChatStampChoice(ADA, { payWith: MessageVia.OWN_STAMP }, storage);
    expect(loadChatStampChoice(ADA, storage)).toEqual({ payWith: MessageVia.OWN_STAMP });
    expect(loadChatStampChoice(BEA, storage), 'another account on this browser starts on the gateway').toEqual(
      GATEWAY_PAYS,
    );
  });

  it('reads nothing kept under the key before choices were kept per account', () => {
    const storage = memory({ 'stream-event-client:chat-stamp': '{"payWith":"own-stamp","ownFeed":true}' });
    expect(loadChatStampChoice(ADA, storage)).toEqual(GATEWAY_PAYS);
  });

  it('keeps no own feed setting, since my stamp always writes one, and ignores one kept by an earlier version', () => {
    const storage = memory({ [chatStampStorageKey(ADA)]: '{"payWith":"own-stamp","ownFeed":false}' });
    expect(loadChatStampChoice(ADA, storage)).toEqual({ payWith: MessageVia.OWN_STAMP });
    saveChatStampChoice(ADA, { payWith: MessageVia.OWN_STAMP }, storage);
    expect(storage.map.get(chatStampStorageKey(ADA))).toBe('{"payWith":"own-stamp"}');
  });

  it('reads anything else it finds there as the gateway paying', () => {
    for (const saved of ['not json', '{"payWith":"someone-else"}', '{}', '[]']) {
      expect(loadChatStampChoice(ADA, memory({ [chatStampStorageKey(ADA)]: saved }))).toEqual(GATEWAY_PAYS);
    }
  });

  it('holds for the visit when the browser refuses its storage', () => {
    expect(loadChatStampChoice(ADA, null)).toEqual(GATEWAY_PAYS);
    expect(() => saveChatStampChoice(ADA, { payWith: MessageVia.OWN_STAMP }, null)).not.toThrow();
  });
});
