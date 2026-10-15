// @vitest-environment jsdom
// @vitest-environment-options {"url":"https://example.com/"}
import { createChatMessage, encodeChatMessage, EVENTS, MessageType, MessageVia } from '@solarpunkltd/swarm-chat-js';
import { act, createElement } from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { saveAddedSources, saveRouting } from '../../src/app/sourceStorage';
import { Chat } from '../../src/features/chat/Chat/Chat';
import type { ChatReads } from '../../src/features/chat/chatParts';
import { saveChatStampChoice } from '../../src/features/chat/stamp/chatStampChoice';
import { STAMP_RAN_OUT } from '../../src/features/chat/stamp/stampProblems';
import type { SwarmIdPostageBatch } from '../../src/features/chat/swarmId/swarmIdClient';
import { chooseSource, defaultRouting } from '../../src/swarm/routing';
import { CHAT, connectPage, seen } from '../helpers/connectPage';
import { wearThemeCss } from '../helpers/themeCss';
import { button, click, nestedLiveRegions, queryButton, settle, type Mounted, waitFor } from '../helpers/dom';
import { FakeSwarmChat } from '../helpers/fakeSwarmChat';
import { ownFeed } from '../helpers/ownFeed';
import { type FakeSwarmId, fakeSwarmId, SIGNED_IN } from '../helpers/fakeSwarmId';
import {
  addressOf,
  BOUND_SITE,
  chatKeyFor,
  idOf,
  inThreadVerifier,
  messageData,
  signedMessage,
} from '../helpers/signedChat';

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

const weeb3Pushes = vi.hoisted(() => ({ pushed: [] as Array<{ identifier: string; stamp: string }> }));

vi.mock('../../src/swarm/providers/weeb-3/weeb3Push', async (importActual) => ({
  ...(await importActual<typeof import('../../src/swarm/providers/weeb-3/weeb3Push')>()),
  pushStampedSocThroughWeeb3: async (chunk: { identifier: string; stamp: string }) => {
    weeb3Pushes.pushed.push({ identifier: chunk.identifier, stamp: chunk.stamp });
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
let reads: ChatReads = READS;
/** The chat address the fake Swarm ID's session signs as on this site, which the who-pays choice is kept under. */
let signedInAddress = '';

beforeAll(async () => {
  signedInAddress = addressOf(await chatKeyFor(BOUND_SITE));
});
let posted: Array<{ url: string; stamp: string | null }> = [];
const realFetch = globalThis.fetch;

function chatOnWeeb3() {
  saveAddedSources([{ id: 'added-1', type: 'weeb-3', name: 'Weeb3', url: '' }]);
  saveRouting(chooseSource(defaultRouting('event'), 'added-1'));
}

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
    children: [createElement(Chat, { key: 'chat', chat: CHAT, topic: 'stream-one', reads: () => reads })],
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
  reads = READS;
  FakeSwarmChat.reset();
  verifier.current = inThreadVerifier();
  localStorage.clear();
  posted = [];
  weeb3Pushes.pushed = [];
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
    saveChatStampChoice(signedInAddress, { payWith: MessageVia.OWN_STAMP });
    const swarmId = await watchPage();

    const chat = FakeSwarmChat.latest();
    expect(chat.settings.infra).toMatchObject({ via: MessageVia.OWN_STAMP, writeUrl: NODE });
    const { bytes } = { bytes: new TextEncoder().encode(JSON.stringify(signedMessage('mine'))) };
    await chat.parts?.write?.(bytes);
    await waitFor(() => (posted.length === 2 ? true : null));

    expect(swarmId.client().stamped, 'the message, then its copy in my own feed').toHaveLength(2);
    for (const chunk of posted) {
      expect(chunk.url.startsWith(`${NODE}/soc/`)).toBe(true);
      expect(chunk.stamp).toBe('e'.repeat(226));
    }
  });

  it('pushes each message through Weeb3 when it reads the chat, stamped by Swarm ID, and posts it to no node', async () => {
    chatOnWeeb3();
    saveChatStampChoice(signedInAddress, { payWith: MessageVia.OWN_STAMP });
    const swarmId = await watchPage();

    const chat = FakeSwarmChat.latest();
    expect(chat.settings.infra.via).toBe(MessageVia.OWN_STAMP);
    expect(chat.settings.infra).not.toHaveProperty('writeUrl');
    expect(seen.chatStamp?.warning, 'Weeb3 can send on my stamp, so nothing holds the message').toBeNull();
    await chat.parts?.write?.(new TextEncoder().encode(JSON.stringify(signedMessage('through weeb-3'))));
    await waitFor(() => (weeb3Pushes.pushed.length === 2 ? true : null));

    expect(swarmId.client().stamped, 'the message, then its copy in my own feed').toHaveLength(2);
    expect(weeb3Pushes.pushed.map(({ stamp }) => stamp)).toEqual(['e'.repeat(226), 'e'.repeat(226)]);
    expect(posted).toEqual([]);
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

  it('signs every message on my stamp as keeping a copy, with nothing to switch on', async () => {
    chatOnMyBeeNode();
    await watchPage();
    expect(FakeSwarmChat.latest().settings.infra.own, 'no copy while the gateway pays').toBeFalsy();

    await act(async () => seen.chatStamp?.choosePayWith(MessageVia.OWN_STAMP));
    await settle();

    expect(FakeSwarmChat.latest().settings.infra).toMatchObject({ via: MessageVia.OWN_STAMP, own: true });
  });

  it('shows a message Swarm ID would not stamp as not sent, with the reason, and sends it nowhere else', async () => {
    chatOnMyBeeNode();
    saveChatStampChoice(signedInAddress, { payWith: MessageVia.OWN_STAMP });
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

  it('marks a failed message to be written again when its retry comes after the way messages are sent changed', async () => {
    chatOnMyBeeNode();
    saveChatStampChoice(signedInAddress, { payWith: MessageVia.OWN_STAMP });
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
    const first = FakeSwarmChat.latest();
    await act(async () => first.emitter.emit(EVENTS.MESSAGE_REQUEST_INITIATED, messageData(mine, -1)));
    await act(async () => {
      await first.parts?.write?.(new TextEncoder().encode(JSON.stringify(mine))).catch(() => {});
    });
    await settle();

    await act(async () => seen.chatStamp?.choosePayWith(MessageVia.GATEWAY));
    await settle();
    const restarted = FakeSwarmChat.latest();
    expect(restarted).not.toBe(first);
    restarted.retrySendMessage.mockReturnValue(false);

    click(button('Retry'));
    await settle();

    expect(chatRegion()?.textContent).toContain('Not sent. The way messages are sent changed, so write it again.');
    expect(queryButton('Retry')).toBeNull();
    expect(posted).toEqual([]);
  });

  it('warns above the message field when the stamp ran out, holds the message, and lets the viewer pick the gateway', async () => {
    chatOnMyBeeNode();
    saveChatStampChoice(signedInAddress, { payWith: MessageVia.OWN_STAMP });
    await watchPage({ ...BATCH, utilization: 1 });

    expect(chatRegion()?.textContent).toContain('Your stamp ran out.');
    expect(button('Send').disabled).toBe(true);

    click(button('Let the gateway pay'));
    await settle();

    expect(seen.chatStamp?.choice.payWith).toBe(MessageVia.GATEWAY);
    expect(queryButton('Let the gateway pay')).toBeNull();
  });

  it('warns when the chat source cannot send on my stamp, and never sends through the gateway in its place', async () => {
    saveChatStampChoice(signedInAddress, { payWith: MessageVia.OWN_STAMP });
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
    wearThemeCss();
    chatOnMyBeeNode();
    saveChatStampChoice(signedInAddress, { payWith: MessageVia.OWN_STAMP });
    const swarmId = await watchPage({ ...BATCH, utilization: 0.9, batchTTL: 2 * DAY_S });

    expect(chatRegion()?.textContent).toContain('90% of your stamp is used.');
    expect(chatRegion()?.textContent).toContain('It runs out in about 2 days.');
    expect(button('Change stamp in Swarm ID')).toBeTruthy();
    expect(nestedLiveRegions(chatRegion()!), "Swarm ID's button says its own news, outside the warning's").toEqual([]);
    expect(seen.chatStamp?.warning?.blocksSending).toBe(false);
    expect(swarmId.client().shownButton().config, "the page's secondary button while sending goes on").toMatchObject({
      backgroundColor: 'rgba(250,250,250,0.1)',
    });
  });

  it("opens the Swarm ID window from Swarm ID's button in the warning, says when it was blocked, and lifts the hold once a stamp is picked there", async () => {
    chatOnMyBeeNode();
    saveChatStampChoice(signedInAddress, { payWith: MessageVia.OWN_STAMP });
    wearThemeCss();
    const swarmId = await watchPage({ ...BATCH, utilization: 1 });
    swarmId.client().nextWindow = 'blocked';

    click(button('Change stamp in Swarm ID'));
    expect(swarmId.client().shownButton().action).toBe('change-stamp');
    expect(swarmId.client().shownButton().config, "the page's primary button while sending is held").toMatchObject({
      backgroundColor: '#f47a20',
    });
    expect(chatRegion()?.textContent).toContain('Your browser blocked the Swarm ID window.');
    expect(nestedLiveRegions(chatRegion()!)).toEqual([]);
    expect(queryButton('Open Swarm ID')).toBeNull();

    swarmId.client().nextWindow = 'opens';
    click(button('Change stamp in Swarm ID'));
    swarmId.client().pickStamp({ ...BATCH, label: 'A new stamp' });
    await settle();
    await settle();

    expect(swarmId.client().windowsOpened).toBe(1);
    expect(swarmId.client().connectCalls).toBe(0);
    expect(chatRegion()?.textContent).not.toContain('Your stamp ran out.');
    expect(chatRegion()?.textContent).not.toContain('Your browser blocked the Swarm ID window.');
    expect(seen.chatStamp?.warning, 'nothing holds a message any more').toBeNull();
  });
});

describe("a sender's own copies in the message details", () => {
  const SENDER_KEY = 'a1'.repeat(32);
  const copyOf = (index: number, text = `copy ${index}`) =>
    createChatMessage(SENDER_KEY, {
      id: idOf(`own-${index}`),
      topic: 'chat-stream-one',
      type: MessageType.TEXT,
      text,
      name: 'Bea',
      ts: 1_000 + index,
      via: MessageVia.OWN_STAMP,
      own: true,
    }).message;

  async function openDetailsOf(count: number, tamperedAt: number | null = null) {
    const copies = Array.from({ length: count }, (_, index) =>
      index === tamperedAt ? { ...copyOf(index), text: 'changed after signing' } : copyOf(index),
    );
    reads = ownFeed(
      SENDER_KEY,
      'chat-stream-one',
      copies.map((copy) => encodeChatMessage(copy)),
    ).reads;
    await watchPage();
    const newest = copyOf(count - 1);
    await act(async () => FakeSwarmChat.latest().emitter.emit(EVENTS.MESSAGE_RECEIVED, messageData(newest, 0)));
    await waitFor(() => (chatRegion()?.textContent?.includes(newest.text) ? true : null));
    click(button('Sent with their own stamp, show details'));
    await waitFor(() => document.querySelector('[aria-label="Their own copies"] li'));
    await settle();
    return document.querySelector<HTMLElement>('[aria-label="Their own copies"]')!;
  }

  const listed = (section: HTMLElement) =>
    [...section.querySelectorAll('li .own-copy-text')].map((item) => item.textContent);

  it("lists the copies in the sender's own feed, newest first, ten at a time, and loads more", async () => {
    const section = await openDetailsOf(12);

    expect(listed(section)).toEqual(Array.from({ length: 10 }, (_, at) => `copy ${11 - at}`));
    click(button('Load more'));
    await waitFor(() => (listed(section).length === 12 ? true : null));
    expect(listed(section).slice(10)).toEqual(['copy 1', 'copy 0']);
    expect(queryButton('Load more')).toBeNull();
  });

  it('hides a copy that fails its check', async () => {
    const section = await openDetailsOf(3, 1);
    expect(listed(section)).toEqual(['copy 2', 'copy 0']);
    expect(section.textContent).not.toContain('changed after signing');
  });

  it('is not offered for a message that says it keeps no copy', async () => {
    await watchPage();
    const plain = signedMessage('no-copy', { key: SENDER_KEY, via: MessageVia.OWN_STAMP });
    await act(async () => FakeSwarmChat.latest().emitter.emit(EVENTS.MESSAGE_RECEIVED, messageData(plain, 0)));
    await waitFor(() => (chatRegion()?.textContent?.includes(plain.text) ? true : null));
    click(button('Sent with their own stamp, show details'));
    await settle();
    expect(document.querySelector('[aria-label="Details for this message"]')).not.toBeNull();
    expect(document.querySelector('[aria-label="Their own copies"]')).toBeNull();
  });
});
