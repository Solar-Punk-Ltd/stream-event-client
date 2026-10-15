import { MessageType, verifyChatMessage } from '@solarpunkltd/swarm-chat-js';
import { createChatMessage } from '@solarpunkltd/swarm-chat-js/message';
import { beforeAll, describe, expect, it } from 'vitest';

import type { ChatConfig } from '../../src/config/runtimeConfig';
import { chatSettings } from '../../src/features/chat/chatSettings';
import { swarmIdSession } from '../../src/features/chat/swarmId/swarmIdSession';
import { FORK_BINDING, FORK_IDENTITY } from '../helpers/fakeSwarmId';
import { BOUND_SITE, chatKeyFor } from '../helpers/signedChat';
import {
  FORK_CHAT_WALLET_LINK,
  FORK_WALLET_LINK,
  LINK_WALLET,
  OTHER_ACCOUNT_WALLET_LINK,
} from '../helpers/walletLinks';

const CHAT: ChatConfig = {
  enabled: true,
  readUrl: '/chat-read',
  writeUrl: '/chat-write',
  gsocResourceId: 'd'.repeat(64),
  gsocTopic: 'gsoc-topic',
  feedOwner: '0x' + 'b'.repeat(40),
  pollIntervalMs: 750,
};

const PAGE = { origin: BOUND_SITE, allowLocalHttp: false };

let chatKey: Uint8Array;

beforeAll(async () => {
  chatKey = Uint8Array.from((await chatKeyFor(BOUND_SITE)).match(/../g) ?? [], (pair) => parseInt(pair, 16));
});

function sessionFor(identity: Parameters<typeof swarmIdSession>[0]) {
  const result = swarmIdSession(identity, FORK_BINDING, chatKey, PAGE);
  if (!result.ok) {
    throw new Error(`expected a session, Swarm ID's answer was refused: ${result.problem}`);
  }
  return result.session;
}

describe("a Swarm ID viewer's wallet link", () => {
  it("goes to the chat in the chat's spelling while Swarm ID shares it", () => {
    const session = sessionFor({ ...FORK_IDENTITY, walletLink: FORK_WALLET_LINK });

    expect(chatSettings(CHAT, 'stream-one', session).user.walletLink).toEqual(FORK_CHAT_WALLET_LINK);
  });

  it('rides on every message, which a reader then checks to the wallet', () => {
    const { user, infra } = chatSettings(
      CHAT,
      'stream-one',
      sessionFor({ ...FORK_IDENTITY, walletLink: FORK_WALLET_LINK }),
    );
    const sent = createChatMessage(user.privateKey, {
      topic: infra.chatTopic,
      type: MessageType.TEXT,
      text: 'hello',
      name: user.nickname,
      via: infra.via,
      ...(user.binding ? { idb: user.binding } : {}),
      ...(user.walletLink ? { wl: user.walletLink } : {}),
    }).message;

    const check = verifyChatMessage(sent, { origin: BOUND_SITE });
    expect(check.ok && check.identity?.wallet).toBe(LINK_WALLET);
  });

  it('is not sent while Swarm ID shares none', () => {
    expect(chatSettings(CHAT, 'stream-one', sessionFor(FORK_IDENTITY)).user).not.toHaveProperty('walletLink');
  });

  it('is left out when it names another account, so the viewer still chats and no reader refuses the messages', () => {
    const session = sessionFor({ ...FORK_IDENTITY, walletLink: OTHER_ACCOUNT_WALLET_LINK });

    expect(chatSettings(CHAT, 'stream-one', session).user).not.toHaveProperty('walletLink');
    expect(chatSettings(CHAT, 'stream-one', session).user.binding).toBeDefined();
  });

  it('is never sent for a guest', () => {
    const guest = { username: 'Ada', privateKey: 'a1'.repeat(32), address: 'f'.repeat(40) };
    expect(chatSettings(CHAT, 'stream-one', guest).user).not.toHaveProperty('walletLink');
  });
});
