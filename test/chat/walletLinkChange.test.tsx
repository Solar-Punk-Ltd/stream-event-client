// @vitest-environment jsdom
// @vitest-environment-options {"url":"https://example.com/"}
import { type ChatMessage, EVENTS, MessageType } from '@solarpunkltd/swarm-chat-js';
import { createChatMessage } from '@solarpunkltd/swarm-chat-js/message';
import { act, createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Chat } from '../../src/features/chat/Chat/Chat';
import type { ChatReads } from '../../src/features/chat/chatParts';
import type { SwarmIdConnectionInfo } from '../../src/features/chat/swarmId/swarmIdClient';
import { CHAT, connectPage, seen } from '../helpers/connectPage';
import { input, type Mounted, press, settle, type, waitFor } from '../helpers/dom';
import { FakeSwarmChat } from '../helpers/fakeSwarmChat';
import { type FakeSwarmId, fakeSwarmId, FORK_BINDING, FORK_IDENTITY } from '../helpers/fakeSwarmId';
import { FORK_CHAT_WALLET_LINK, FORK_WALLET_LINK } from '../helpers/walletLinks';

vi.mock('@solarpunkltd/swarm-chat-js', async (importActual) => {
  const actual = await importActual<typeof import('@solarpunkltd/swarm-chat-js')>();
  const { FakeSwarmChat } = await import('../helpers/fakeSwarmChat');
  return { ...actual, SwarmChat: FakeSwarmChat };
});

vi.mock('emoji-picker-react', () => ({
  default: () => null,
  EmojiStyle: { NATIVE: 'native' },
  Theme: { DARK: 'dark' },
}));

const READS: ChatReads = {
  readFeedHead: async () => ({ kind: 'not-found', serverTimeMs: null }),
  readChunk: async () => ({ kind: 'not-found', serverTimeMs: null }),
  readBytes: async () => ({ kind: 'not-found', serverTimeMs: null }),
};

const LINK_SHARED: SwarmIdConnectionInfo = {
  identity: { ...FORK_IDENTITY, walletLink: FORK_WALLET_LINK },
  chatBinding: FORK_BINDING,
};
const LINK_WITHHELD: SwarmIdConnectionInfo = { identity: FORK_IDENTITY, chatBinding: FORK_BINDING };

let mounted: Mounted | null = null;
const realFetch = globalThis.fetch;

async function watchPage(kept: SwarmIdConnectionInfo): Promise<FakeSwarmId> {
  const swarmId = await fakeSwarmId(kept);
  mounted = connectPage({
    swarmId,
    children: [createElement(Chat, { key: 'chat', chat: CHAT, topic: 'stream-one', reads: () => READS })],
  });
  await settle();
  await waitFor(() => seen.chatUser?.swarmIdSession);
  await settle();
  await act(async () => FakeSwarmChat.latest().emitter.emit(EVENTS.LOADING_INIT, false));
  await settle();
  return swarmId;
}

/**
 * Every message the page sent, as the chat library signs it: the library takes the sender's profile, the wallet link
 * among it, once, when the chat is built, so a message carries the link of the chat that sent it.
 */
function sentMessages(): ChatMessage[] {
  return FakeSwarmChat.instances.flatMap((chat) => {
    const { user, infra } = chat.settings;
    return chat.sendMessage.mock.calls.map((call) => {
      const [text] = call as unknown as [string];
      return createChatMessage(user.privateKey, {
        topic: infra.chatTopic,
        type: MessageType.TEXT,
        text,
        name: user.nickname,
        via: infra.via,
        ...(user.binding ? { idb: user.binding } : {}),
        ...(user.walletLink ? { wl: user.walletLink } : {}),
      }).message;
    });
  });
}

/**
 * A new session restarts the chat for it, on a turn after the one it lands in, and a message sent between the two
 * reaches no chat at all. Two turns give a session that landed at once its new chat.
 */
async function reported(swarmId: FakeSwarmId, info: SwarmIdConnectionInfo): Promise<void> {
  swarmId.client().handOver(info);
  await settle();
  await settle();
}

async function send(text: string): Promise<ChatMessage> {
  const before = sentMessages().length;
  type(input('Message'), text);
  press(input('Message'), 'Enter');
  await settle();
  const sent = sentMessages();
  expect(sent, `"${text}" was sent`).toHaveLength(before + 1);
  return sent[sent.length - 1];
}

beforeEach(() => {
  FakeSwarmChat.reset();
  localStorage.clear();
  globalThis.fetch = (async () => new Response('', { status: 404 })) as typeof fetch;
});

afterEach(() => {
  mounted?.unmount();
  mounted = null;
  globalThis.fetch = realFetch;
  document.body.innerHTML = '';
});

describe('"Show my ENS name" changed in Swarm ID while the viewer is signed in', () => {
  it('turned off: the next message carries no wallet link', async () => {
    const swarmId = await watchPage(LINK_SHARED);
    expect((await send('before')).wl).toEqual(FORK_CHAT_WALLET_LINK);

    await reported(swarmId, LINK_WITHHELD);

    expect(await send('after')).not.toHaveProperty('wl');
  });

  it('turned on: the next message carries the wallet link', async () => {
    const swarmId = await watchPage(LINK_WITHHELD);
    expect(await send('before')).not.toHaveProperty('wl');

    await reported(swarmId, LINK_SHARED);

    expect((await send('after')).wl).toEqual(FORK_CHAT_WALLET_LINK);
  });

  it('turned off while the frame is slow to answer: a message written before it and sent after carries no link', async () => {
    const swarmId = await watchPage(LINK_SHARED);
    type(input('Message'), 'written while the link was on');
    swarmId.client().chatKeyWaits = true;

    await reported(swarmId, LINK_WITHHELD);
    press(input('Message'), 'Enter');
    await settle();

    expect(sentMessages()).toHaveLength(1);
    expect(sentMessages()[0]).not.toHaveProperty('wl');
    swarmId.client().giveChatKeys();
    await settle();
    expect(await send('later')).not.toHaveProperty('wl');
  });
});
