// @vitest-environment jsdom
// @vitest-environment-options {"url":"https://example.com/"}
import { EVENTS, MessageType, MessageVia } from '@solarpunkltd/swarm-chat-js';
import { act, createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { saveAddedSources, saveRouting } from '../../src/app/sourceStorage';
import { Chat } from '../../src/features/chat/Chat/Chat';
import type { ChatReads } from '../../src/features/chat/chatParts';
import { saveChatStampChoice } from '../../src/features/chat/stamp/chatStampChoice';
import { STAMP_RAN_OUT } from '../../src/features/chat/stamp/stampProblems';
import type { SwarmIdPostageBatch } from '../../src/features/chat/swarmId/swarmIdClient';
import { chooseSource, defaultRouting } from '../../src/swarm/routing';
import { CHAT, connectPage, seen } from '../helpers/connectPage';
import { button, click, queryButton, settle, type Mounted, waitFor } from '../helpers/dom';
import { FakeSwarmChat } from '../helpers/fakeSwarmChat';
import { type FakeSwarmId, fakeSwarmId, SIGNED_IN } from '../helpers/fakeSwarmId';
import { idOf, inThreadVerifier, messageData, signedMessage } from '../helpers/signedChat';

vi.mock('@solarpunkltd/swarm-chat-js', async (importActual) => {
  const actual = await importActual<typeof import('@solarpunkltd/swarm-chat-js')>();
  const { FakeSwarmChat } = await import('../helpers/fakeSwarmChat');
  return { ...actual, SwarmChat: FakeSwarmChat };
});

const verifier = vi.hoisted(() => ({ current: null as ReturnType<typeof inThreadVerifier> | null }));

vi.mock('../../src/features/chat/verify/chatVerifier', () => ({
  chatVerifier: () => {
    if (!verifier.current) throw new Error('the test set no verifier');
    return verifier.current;
  },
}));

vi.mock('emoji-picker-react', () => ({
  default: () => null,
  EmojiStyle: { NATIVE: 'native' },
  Theme: { DARK: 'dark' },
}));

const DAY_S = 24 * 60 * 60;
const BATCH: SwarmIdPostageBatch = { label: '', utilization: 0.3, usable: true, exists: true, batchTTL: 30 * DAY_S };
const NODE = 'http://localhost:1633';

const READS: ChatReads = {
  readFeedHead: async () => ({ kind: 'not-found', serverTimeMs: null }),
  readChunk: async () => ({ kind: 'not-found', serverTimeMs: null }),
  readBytes: async () => ({ kind: 'not-found', serverTimeMs: null }),
};

let mounted: Mounted | null = null;
let posted: Array<{ url: string; stamp: string | null }> = [];
const realFetch = globalThis.fetch;

function chatOnMyBeeNode() {
  saveAddedSources([{ id: 'added-1', type: 'bee-node', name: 'My Bee node', url: NODE }]);
  saveRouting(chooseSource(defaultRouting('event'), 'added-1'));
}

async function watchPage(batch: SwarmIdPostageBatch = BATCH): Promise<FakeSwarmId> {
  const swarmId = await fakeSwarmId(SIGNED_IN, (client) => {
    client.postageBatch = batch;
  });
  mounted = connectPage({
    swarmId,
    children: [createElement(Chat, { key: 'chat', chat: CHAT, topic: 'stream-one', reads: () => READS })],
  });
  await settle();
  await waitFor(() => seen.chatUser?.swarmIdSession);
  await waitFor(() => (seen.chatStamp?.siteStamp.status === 'read' ? true : null));
  await settle();
  await act(async () => FakeSwarmChat.latest().emitter.emit(EVENTS.LOADING_INIT, false));
  await settle();
  return swarmId;
}

const chatRegion = () => document.querySelector<HTMLElement>('.chat-container');

beforeEach(() => {
  FakeSwarmChat.reset();
  verifier.current = inThreadVerifier();
  localStorage.clear();
  posted = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    if (init?.method === 'POST') {
      posted.push({ url: String(input), stamp: new Headers(init.headers).get('swarm-postage-stamp') });
      return new Response('{}', { status: 201 });
    }
    return new Response('', { status: 404 });
  }) as typeof fetch;
});

afterEach(() => {
  mounted?.unmount();
  mounted = null;
  globalThis.fetch = realFetch;
  document.body.innerHTML = '';
});

describe('a chat paid for with my own stamp', () => {
  it('lets the gateway pay until the viewer picks their stamp', async () => {
    chatOnMyBeeNode();
    await watchPage();
    expect(FakeSwarmChat.latest().settings.infra).toMatchObject({ via: MessageVia.GATEWAY, writeUrl: CHAT.writeUrl });
  });

  it("writes each message through the viewer's Bee node, stamped by Swarm ID, and says so in every message", async () => {
    chatOnMyBeeNode();
    saveChatStampChoice({ payWith: MessageVia.OWN_STAMP, ownFeed: false });
    const swarmId = await watchPage();

    const chat = FakeSwarmChat.latest();
    expect(chat.settings.infra).toMatchObject({ via: MessageVia.OWN_STAMP, writeUrl: NODE });
    const { bytes } = { bytes: new TextEncoder().encode(JSON.stringify(signedMessage('mine'))) };
    await chat.parts?.write?.(bytes);

    expect(swarmId.client().stamped).toHaveLength(1);
    expect(posted).toHaveLength(1);
    expect(posted[0].url.startsWith(`${NODE}/soc/`)).toBe(true);
    expect(posted[0].stamp).toBe('e'.repeat(226));
  });

  it('keeps the messages on screen when the viewer changes who pays', async () => {
    chatOnMyBeeNode();
    await watchPage();
    const shown = signedMessage('kept');
    await act(async () => FakeSwarmChat.latest().emitter.emit(EVENTS.MESSAGE_RECEIVED, messageData(shown, 0)));
    await waitFor(() => (chatRegion()?.textContent?.includes(shown.text) ? true : null));

    await act(async () => seen.chatStamp?.choosePayWith(MessageVia.OWN_STAMP));
    await settle();

    expect(FakeSwarmChat.latest().settings.infra.via).toBe(MessageVia.OWN_STAMP);
    expect(chatRegion()?.textContent).toContain(shown.text);
  });

  it('shows a message Swarm ID would not stamp as not sent, with the reason, and sends it nowhere else', async () => {
    chatOnMyBeeNode();
    saveChatStampChoice({ payWith: MessageVia.OWN_STAMP, ownFeed: false });
    const swarmId = await watchPage();
    swarmId.client().stampRefusal = Object.assign(new Error('expired'), {
      code: 'upload-unavailable',
      reason: 'stamp-expired',
    });
    const mine = signedMessage('refused', {
      key: seen.chatUser!.session!.privateKey,
      name: seen.chatUser!.session!.username,
      binding: seen.chatUser!.session!.binding,
      via: MessageVia.OWN_STAMP,
    });
    const chat = FakeSwarmChat.latest();
    await act(async () => chat.emitter.emit(EVENTS.MESSAGE_REQUEST_INITIATED, messageData(mine, -1)));
    await act(async () => {
      await chat.parts?.write?.(new TextEncoder().encode(JSON.stringify(mine))).catch(() => {});
    });
    await settle();

    expect(chatRegion()?.textContent).toContain(`Not sent. ${STAMP_RAN_OUT}`);
    expect(posted).toEqual([]);
    click(button('Retry'));
    expect(chat.retrySendMessage).toHaveBeenCalled();
  });

  it('warns above the message field when the stamp ran out, holds the message, and lets the viewer pick the gateway', async () => {
    chatOnMyBeeNode();
    saveChatStampChoice({ payWith: MessageVia.OWN_STAMP, ownFeed: false });
    await watchPage({ ...BATCH, utilization: 1 });

    expect(chatRegion()?.textContent).toContain('Your stamp ran out.');
    expect(button('Send').disabled).toBe(true);

    click(button('Let the gateway pay'));
    await settle();

    expect(seen.chatStamp?.choice.payWith).toBe(MessageVia.GATEWAY);
    expect(queryButton('Let the gateway pay')).toBeNull();
  });

  it('warns when the chat source cannot send on my stamp, and never sends through the gateway in its place', async () => {
    saveChatStampChoice({ payWith: MessageVia.OWN_STAMP, ownFeed: false });
    await watchPage();

    const chat = FakeSwarmChat.latest();
    expect(chat.settings.infra.via).toBe(MessageVia.OWN_STAMP);
    expect(chat.settings.infra).not.toHaveProperty('writeUrl');
    expect(chatRegion()?.textContent).toContain('The event gateway stamps every chat message');
    const reaction = signedMessage('reaction', {
      type: MessageType.REACTION,
      target: idOf('someone'),
      text: '👍',
      via: MessageVia.OWN_STAMP,
    });
    await expect(chat.parts?.write?.(new TextEncoder().encode(JSON.stringify(reaction)))).rejects.toThrow();
    expect(posted).toEqual([]);
  });

  it('warns while the stamp runs low, and still sends', async () => {
    chatOnMyBeeNode();
    saveChatStampChoice({ payWith: MessageVia.OWN_STAMP, ownFeed: false });
    await watchPage({ ...BATCH, utilization: 0.9, batchTTL: 2 * DAY_S });

    expect(chatRegion()?.textContent).toContain('90% of your stamp is used.');
    expect(chatRegion()?.textContent).toContain('It runs out in about 2 days.');
    expect(button('Change stamp in Swarm ID')).toBeTruthy();
  });
});
