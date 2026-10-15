import { MessageType, MessageVia } from '@solarpunkltd/swarm-chat-js';
import { beforeAll, describe, expect, it } from 'vitest';

import type { ChatConfig } from '../../src/config/runtimeConfig';
import type { Session } from '../../src/features/chat/auth/login';
import { chatSettings } from '../../src/features/chat/chatSettings';
import { draftProblem, TOO_MANY_BYTES } from '../../src/features/chat/draftCheck';
import { addressOf, BOUND_SITE, CHAT_BINDING, chatKeyFor, GUEST_KEY } from '../helpers/signedChat';

const CHAT: ChatConfig = {
  enabled: true,
  readUrl: '/chat-read',
  writeUrl: '/chat-write',
  gsocResourceId: 'd'.repeat(64),
  gsocTopic: 'gsoc-topic',
  feedOwner: '0x' + 'b'.repeat(40),
  pollIntervalMs: 750,
};

let boundKey: string;

beforeAll(async () => {
  boundKey = await chatKeyFor(BOUND_SITE);
});

describe('the chat settings', () => {
  it('send through the event gateway, which pays for every write', () => {
    expect(chatSettings(CHAT, 'stream-one', null).infra.via).toBe(MessageVia.GATEWAY);
  });

  it("send through the viewer's own Bee node on their own stamp, and say so in every message", () => {
    const infra = chatSettings(CHAT, 'stream-one', null, {
      via: MessageVia.OWN_STAMP,
      url: 'http://localhost:1633',
    }).infra;
    expect(infra).toMatchObject({ via: MessageVia.OWN_STAMP, writeUrl: 'http://localhost:1633', beeUrl: '/chat-read' });
    expect(infra).not.toHaveProperty('stamp');
  });

  it('have the chat sign every message on my stamp as keeping a copy, so a resend is the same bytes', () => {
    expect(chatSettings(CHAT, 'stream-one', null, { via: MessageVia.OWN_STAMP, url: null }).infra.own).toBe(true);
    expect(chatSettings(CHAT, 'stream-one', null).infra.own, 'no copy while the gateway pays').toBeFalsy();
  });

  it("send a guest's messages with no binding", () => {
    const guest: Session = { username: 'Ada', privateKey: GUEST_KEY, address: addressOf(GUEST_KEY) };
    expect(chatSettings(CHAT, 'stream-one', guest).user).toEqual({ privateKey: GUEST_KEY, nickname: 'Ada' });
  });

  it("hand a signed-in viewer's Swarm ID binding to the chat, so every message carries it", () => {
    const signedIn: Session = {
      username: 'Ada',
      privateKey: boundKey,
      address: addressOf(boundKey),
      binding: CHAT_BINDING,
    };
    expect(chatSettings(CHAT, 'stream-one', signedIn).user).toEqual({
      privateKey: boundKey,
      nickname: 'Ada',
      binding: CHAT_BINDING,
    });
  });
});

describe('a draft', () => {
  const draft = { topic: 'chat-stream-one', name: 'Ada', type: MessageType.TEXT, via: MessageVia.GATEWAY };

  it('is measured with the binding it will carry, so a long text that fits a guest is refused for an ID', () => {
    const text = '\u0001'.repeat(430);
    expect(draftProblem({ ...draft, text })).toBeNull();
    expect(draftProblem({ ...draft, text, binding: CHAT_BINDING })).toBe(TOO_MANY_BYTES);
  });
});
