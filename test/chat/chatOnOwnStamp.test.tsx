// @vitest-environment jsdom
// @vitest-environment-options {"url":"https://example.com/"}
import { FeedIndex, Topic } from '@ethersphere/bee-js';
import {
  type ChatMessage,
  createChatMessage,
  EVENTS,
  MessageType,
  MessageVia,
  ownFeedTopic,
} from '@solarpunkltd/swarm-chat-js';
import { act, createElement } from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { saveAddedSources, saveRouting } from '../../src/app/sourceStorage';
import { Chat } from '../../src/features/chat/Chat/Chat';
import type { ChatReads } from '../../src/features/chat/chatParts';
import { saveChatStampChoice } from '../../src/features/chat/stamp/chatStampChoice';
import { OWN_COPY_RETRY_MS } from '../../src/features/chat/stamp/ownFeedCopies';
import { STAMP_RAN_OUT } from '../../src/features/chat/stamp/stampProblems';
import { OWN_STAMP_NEEDS_SOURCE } from '../../src/features/connect/connectWords';
import type { SwarmIdPostageBatch } from '../../src/features/chat/swarmId/swarmIdClient';
import { makeFeedIdentifier } from '../../src/shared/feedFollow';
import type { SwarmAnswer } from '../../src/swarm/answers';
import { chooseSource, defaultRouting } from '../../src/swarm/routing';
import { CHAT, connectPage, seen } from '../helpers/connectPage';
import { wearThemeCss } from '../helpers/themeCss';
import {
  button,
  click,
  input,
  nestedLiveRegions,
  queryButton,
  settle,
  type,
  type Mounted,
  waitFor,
} from '../helpers/dom';
import { FakeSwarmChat } from '../helpers/fakeSwarmChat';
import { servedFeeds } from '../helpers/chatFeed';
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

async function watchPage(batch: SwarmIdPostageBatch = BATCH, chat: typeof CHAT = CHAT): Promise<FakeSwarmId> {
  const swarmId = await fakeSwarmId(SIGNED_IN, (client) => {
    client.postageBatch = batch;
  });
  mounted = connectPage({
    swarmId,
    children: [createElement(Chat, { key: 'chat', chat, topic: 'stream-one', reads: () => reads })],
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
  vi.useRealTimers();
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

  it('asks the chat to sign no own field on my stamp, whose copy is read from my own feed instead', async () => {
    chatOnMyBeeNode();
    await watchPage();
    await act(async () => seen.chatStamp?.choosePayWith(MessageVia.OWN_STAMP));
    await settle();

    expect(FakeSwarmChat.latest().settings.infra.via).toBe(MessageVia.OWN_STAMP);
    expect(FakeSwarmChat.latest().settings.infra).not.toHaveProperty('own');
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

  it('shows the stamp as ran out once Swarm ID refused it for that, though its figures said time was left', async () => {
    chatOnMyBeeNode();
    saveChatStampChoice(signedInAddress, { payWith: MessageVia.OWN_STAMP });
    const swarmId = await watchPage();
    expect(seen.chatStamp?.warning, 'the figures Swarm ID reported say the stamp is fine').toBeNull();
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
    await act(async () => {
      await chat.parts?.write?.(new TextEncoder().encode(JSON.stringify(mine))).catch(() => {});
    });
    await settle();

    expect(seen.chatStamp?.warning?.title).toBe(STAMP_RAN_OUT);
    expect(button('Send').disabled).toBe(true);

    await act(async () => window.dispatchEvent(new Event('focus')));
    await settle();

    expect(swarmId.client().postageBatchReads, 'read again on focus').toBeGreaterThan(1);
    expect(seen.chatStamp?.warning?.title, 'a read of the same stamp does not undo the refusal').toBe(STAMP_RAN_OUT);
  });

  it('says why a message is still being sent while Swarm ID asks for it to be tried again, and stops once it went', async () => {
    chatOnMyBeeNode();
    saveChatStampChoice(signedInAddress, { payWith: MessageVia.OWN_STAMP });
    const swarmId = await watchPage();
    swarmId.client().stampRefusal = Object.assign(new Error('unconfirmed'), {
      code: 'upload-unavailable',
      reason: 'session-unconfirmed',
    });
    const mine = signedMessage('waiting', {
      key: seen.chatUser!.session!.privateKey,
      name: seen.chatUser!.session!.username,
      binding: seen.chatUser!.session!.binding,
      via: MessageVia.OWN_STAMP,
    });
    const chat = FakeSwarmChat.latest();
    const write = () =>
      act(async () => {
        await chat.parts?.write?.(new TextEncoder().encode(JSON.stringify(mine))).catch(() => {});
      });
    await act(async () => chat.emitter.emit(EVENTS.MESSAGE_REQUEST_INITIATED, messageData(mine, -1)));
    await write();
    await settle();

    expect(chatRegion()?.textContent).toContain('Sending… Swarm ID is still checking your session. Trying again.');
    expect(chatRegion()?.textContent).not.toContain('Not sent.');

    swarmId.client().stampRefusal = null;
    await write();
    await settle();

    expect(chatRegion()?.textContent).toContain('Sending…');
    expect(chatRegion()?.textContent).not.toContain('still checking your session');
  });

  it('offers to choose a stamp in Swarm ID when it says it gave this site none, though a stamp was shown', async () => {
    chatOnMyBeeNode();
    saveChatStampChoice(signedInAddress, { payWith: MessageVia.OWN_STAMP });
    const swarmId = await watchPage();
    expect(queryButton('Choose a stamp in Swarm ID'), 'a stamp is shown, so nothing to choose yet').toBeNull();
    swarmId.client().stampRefusal = Object.assign(new Error('no stamp'), {
      code: 'upload-unavailable',
      reason: 'no-stamp',
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

    expect(chatRegion()?.textContent).toContain(
      'Not sent. Swarm ID has given this site no stamp. Choose one in Swarm ID.',
    );
    expect(button('Choose a stamp in Swarm ID')).toBe(swarmId.client().shownButton().element);
    expect(posted).toEqual([]);
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

  it('sends through my Bee node from the list while the event gateway reads the chat history', async () => {
    saveAddedSources([{ id: 'added-1', type: 'bee-node', name: 'My Bee node', url: NODE }]);
    saveChatStampChoice(signedInAddress, { payWith: MessageVia.OWN_STAMP });
    await watchPage();

    expect(seen.app?.parts.chat, 'the chat history stays on the event gateway').toBe('event');
    const chat = FakeSwarmChat.latest();
    expect(chat.settings.infra).toMatchObject({ via: MessageVia.OWN_STAMP, writeUrl: NODE });
    expect(seen.chatStamp?.warning).toBeNull();
    type(input('Message'), 'through my node');
    expect(button('Send').disabled).toBe(false);
    await chat.parts?.write?.(new TextEncoder().encode(JSON.stringify(signedMessage('through my node'))));
    await waitFor(() => (posted.length === 2 ? true : null));

    for (const chunk of posted) {
      expect(chunk.url.startsWith(`${NODE}/soc/`)).toBe(true);
    }
    expect(seen.app?.parts.chat).toBe('event');
    expect(seen.chatStamp?.choice.payWith).toBe(MessageVia.OWN_STAMP);
  });

  it('pushes through Weeb3 from the list while a gateway reads the chat history and there is no Bee node', async () => {
    saveAddedSources([{ id: 'added-1', type: 'weeb-3', name: 'Weeb3', url: '' }]);
    saveChatStampChoice(signedInAddress, { payWith: MessageVia.OWN_STAMP });
    await watchPage();

    const chat = FakeSwarmChat.latest();
    expect(chat.settings.infra.via).toBe(MessageVia.OWN_STAMP);
    expect(chat.settings.infra).not.toHaveProperty('writeUrl');
    await chat.parts?.write?.(new TextEncoder().encode(JSON.stringify(signedMessage('through weeb-3'))));
    await waitFor(() => (weeb3Pushes.pushed.length === 2 ? true : null));

    expect(posted).toEqual([]);
    expect(seen.app?.parts.chat).toBe('event');
  });

  it('holds sending with one plain line when there is no Bee node and no Weeb3, and sends nothing to a gateway', async () => {
    saveAddedSources([{ id: 'added-1', type: 'gateway', name: 'My gateway', url: 'https://gw.example.org' }]);
    saveRouting(chooseSource(defaultRouting('event'), 'added-1'));
    saveChatStampChoice(signedInAddress, { payWith: MessageVia.OWN_STAMP });
    await watchPage();

    const chat = FakeSwarmChat.latest();
    expect(chat.settings.infra.via).toBe(MessageVia.OWN_STAMP);
    expect(chat.settings.infra).not.toHaveProperty('writeUrl');
    expect(chatRegion()?.textContent).toContain(OWN_STAMP_NEEDS_SOURCE);
    expect(chatRegion()?.querySelector('.stamp-warning')).toBeNull();
    expect(queryButton('Let the gateway pay')).toBeNull();
    expect(queryButton('Open My Swarm')).toBeNull();
    type(input('Message'), 'held');
    expect(button('Send').disabled).toBe(true);
    const reaction = signedMessage('reaction', {
      type: MessageType.REACTION,
      target: idOf('someone'),
      text: '👍',
      via: MessageVia.OWN_STAMP,
    });
    await expect(chat.parts?.write?.(new TextEncoder().encode(JSON.stringify(reaction)))).rejects.toThrow();
    expect(posted).toEqual([]);
    expect(weeb3Pushes.pushed).toEqual([]);
  });

  it('holds sending with the same line once the last Bee node is removed, keeping my stamp picked', async () => {
    chatOnMyBeeNode();
    saveChatStampChoice(signedInAddress, { payWith: MessageVia.OWN_STAMP });
    await watchPage();
    type(input('Message'), 'kept while held');
    expect(button('Send').disabled).toBe(false);

    await act(async () => seen.app?.removeSource('added-1'));
    await settle();

    expect(seen.chatStamp?.choice.payWith).toBe(MessageVia.OWN_STAMP);
    expect(chatRegion()?.textContent).toContain(OWN_STAMP_NEEDS_SOURCE);
    expect(chatRegion()?.querySelector('.stamp-warning')).toBeNull();
    expect(input('Message').value, 'what was typed is kept').toBe('kept while held');
    expect(button('Send').disabled).toBe(true);
    const chat = FakeSwarmChat.latest();
    expect(chat.settings.infra).not.toHaveProperty('writeUrl');
    await expect(
      chat.parts?.write?.(new TextEncoder().encode(JSON.stringify(signedMessage('nowhere to go')))),
    ).rejects.toThrow();
    expect(posted).toEqual([]);
  });

  it('says nothing while the stamp runs low, and still sends', async () => {
    chatOnMyBeeNode();
    saveChatStampChoice(signedInAddress, { payWith: MessageVia.OWN_STAMP });
    await watchPage({ ...BATCH, utilization: 0.9, batchTTL: 2 * DAY_S });

    expect(chatRegion()?.textContent).not.toContain('of your stamp is used');
    expect(queryButton('Change stamp in Swarm ID')).toBeNull();
    expect(seen.chatStamp?.warning).toBeNull();
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

  it("does not take the page's own hold on a stamp that ran out for Swarm ID's word, so the stamp picked next is not held", async () => {
    chatOnMyBeeNode();
    saveChatStampChoice(signedInAddress, { payWith: MessageVia.OWN_STAMP });
    const swarmId = await watchPage({ ...BATCH, utilization: 1 });
    const mine = signedMessage('held resend', {
      key: seen.chatUser!.session!.privateKey,
      name: seen.chatUser!.session!.username,
      binding: seen.chatUser!.session!.binding,
      via: MessageVia.OWN_STAMP,
    });
    const chat = FakeSwarmChat.latest();
    // Swarm ID already names the new stamp while its figures are still being read, so the bar still holds sending
    // with the old stamp's figures when the chat resends a message.
    swarmId.client().postageBatchHangs = true;
    swarmId.client().pickStamp({ ...BATCH, label: 'A new stamp' });
    await settle();
    await act(async () => {
      await chat.parts?.write?.(new TextEncoder().encode(JSON.stringify(mine))).catch(() => {});
    });
    await settle();

    swarmId.client().postageBatchHangs = false;
    await act(async () => window.dispatchEvent(new Event('focus')));
    await settle();

    expect(seen.chatStamp?.warning, 'the stamp picked next is not held').toBeNull();
  });
});

describe("a sender's own feed in the message details", () => {
  const SENDER_KEY = 'a1'.repeat(32);
  const OTHER_KEY = 'b2'.repeat(32);
  const SERVER_KEY = 'c3'.repeat(32);
  const CHAT_TOPIC = 'chat-stream-one';
  const ON_THIS_SERVER = { ...CHAT, feedOwner: `0x${addressOf(SERVER_KEY)}` };
  const OWN_TOPIC = Topic.fromString(ownFeedTopic(CHAT_TOPIC)).toHex();
  const comparedTopics = [CHAT_TOPIC, ownFeedTopic(CHAT_TOPIC)].map((topic) => Topic.fromString(topic).toHex());
  const signed = (key: string, label: string, via: MessageVia = MessageVia.OWN_STAMP) =>
    createChatMessage(key, {
      id: idOf(label),
      topic: CHAT_TOPIC,
      type: MessageType.TEXT,
      text: `text of ${label}`,
      name: 'Bea',
      ts: 1_000,
      via,
    }).message;
  const mine = (label: string, via?: MessageVia) => signed(SENDER_KEY, label, via);
  const section = () => document.querySelector<HTMLElement>('[aria-label="Own feed"]');
  const ownFeedReads = (feeds: ReturnType<typeof servedFeeds>) =>
    feeds.asked.filter((read) => read.endsWith(OWN_TOPIC) || read.startsWith('chunk')).length;
  const listed = (label: string) =>
    [...(section()?.querySelectorAll(`[aria-label="${label}"] li`) ?? [])].map((item) => item.textContent);
  /** The check's result as its lines read, in order: this message, then each count of what disagrees. */
  const resultLines = (shown: HTMLElement) =>
    [...shown.querySelectorAll('.own-feed-this, .own-feed-missing > span:first-child')].map((line) => line.textContent);

  /** The watch page on a chat that `feeds` serves through `pageReads`, with `shown` in it and its details open. */
  async function openDetailsOn(feeds: ReturnType<typeof servedFeeds>, shown: ChatMessage, pageReads = feeds.reads) {
    reads = pageReads;
    await watchPage(BATCH, ON_THIS_SERVER);
    await act(async () => FakeSwarmChat.latest().emitter.emit(EVENTS.MESSAGE_RECEIVED, messageData(shown, 0)));
    await waitFor(() => (chatRegion()?.textContent?.includes(shown.text) ? true : null));
    click(button('Sent with their own stamp, show details'));
    return section()!;
  }

  /** Opens the details of `shown`, in a chat holding `chatMessages` and an own feed holding `copies`, or none. */
  async function openDetails(
    shown: ChatMessage,
    chatMessages: ChatMessage[],
    copies: ChatMessage[] | null,
    arrange: (feeds: ReturnType<typeof servedFeeds>) => void = () => {},
  ) {
    const feeds = servedFeeds();
    feeds.chat(SERVER_KEY, CHAT_TOPIC, chatMessages, { filesThrough: chatMessages.length > 2 ? [1] : [] });
    if (copies) {
      feeds.ownFeed(SENDER_KEY, CHAT_TOPIC, copies);
    }
    arrange(feeds);
    await openDetailsOn(feeds, shown);
    return feeds;
  }

  async function verify() {
    click(button('Verify'));
    await waitFor(() => (queryButton('Verify') ? true : null));
    return section()!;
  }

  it('opens at once with the own feed address and a copy button, and reads nothing of the own feed', async () => {
    const a = mine('a');
    const feeds = await openDetails(a, [a], [a]);
    const written: string[] = [];
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: async (text: string) => void written.push(text) },
    });

    const owner = addressOf(SENDER_KEY);
    expect(section()?.textContent).toContain(
      `Own feed: ${owner.slice(0, 4)}…${owner.slice(-4)}/${OWN_TOPIC.slice(0, 4)}…`,
    );
    expect(ownFeedReads(feeds)).toBe(0);
    expect(section()?.textContent).not.toContain('no own feed in this chat');

    click(button('Copy the own feed address'));
    await settle();
    expect(written).toEqual([`${owner}/${OWN_TOPIC}`]);
  });

  it('selects the full own feed address for copying by hand when the browser refuses the clipboard', async () => {
    const a = mine('a');
    await openDetails(a, [a], [a]);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: async () => Promise.reject(new Error('refused')) },
    });

    click(button('Copy the own feed address'));
    await settle();

    expect(window.getSelection()?.toString()).toBe(`${addressOf(SENDER_KEY)}/${OWN_TOPIC}`);
  });

  it("says only that this message is in the sender's own feed when the chat and that feed agree", async () => {
    const [a, b] = [mine('a'), mine('b')];
    await openDetails(b, [a, b], [a, b]);

    const shown = await verify();

    expect(resultLines(shown)).toEqual(["This message is in the sender's own feed."]);
    expect(shown.querySelector('.own-feed-missing')).toBeNull();
  });

  it('names the messages missing on each side, newest first, when the feeds differ', async () => {
    const [a, b, c, d] = ['a', 'b', 'c', 'd'].map((label) => mine(label)) as [
      ChatMessage,
      ChatMessage,
      ChatMessage,
      ChatMessage,
    ];
    await openDetails(c, [a, b, c], [a, d]);

    const shown = await verify();

    expect(resultLines(shown)).toEqual([
      "This message is not in the sender's own feed.",
      "2 messages are in this chat but not in the sender's own feed",
      "1 message is in the sender's own feed but not in this chat",
    ]);
    expect(listed("Missing from the sender's own feed")).toEqual([c.text, b.text]);
    expect(listed('Missing from the chat feed')).toEqual([d.text]);
  });

  it('tells messages on their own stamp from those the gateway paid for, and never counts the second missing', async () => {
    const [a, b] = [mine('a'), mine('b')];
    const [free, alsoFree] = [mine('free', MessageVia.GATEWAY), mine('also free', MessageVia.GATEWAY)];
    await openDetails(a, [a, free, b, alsoFree], [a, b]);

    const shown = await verify();

    expect(resultLines(shown)).toEqual(["This message is in the sender's own feed."]);
    expect(shown.querySelector(`[aria-label="Missing from the sender's own feed"]`)).toBeNull();
  });

  it('names the messages in the chat that carry their address but fail the signature check', async () => {
    const [a, b] = [mine('a'), mine('b')];
    const forged = { ...b, text: 'changed after signing' };
    await openDetails(a, [a, forged], [a]);

    const shown = await verify();

    expect(shown.textContent).toContain("1 message carries the sender's address, but its signature does not match");
    expect(listed('Signature does not match')).toEqual(['changed after signing']);
  });

  it('shows how far the check has got, and stops reading when asked', async () => {
    const messages = ['a', 'b', 'c', 'd'].map((label) => mine(label));
    const feeds = servedFeeds();
    feeds.chat(SERVER_KEY, CHAT_TOPIC, messages);
    feeds.ownFeed(SENDER_KEY, CHAT_TOPIC, messages);
    const signals: AbortSignal[] = [];
    let release: () => void = () => {};
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    await openDetailsOn(feeds, messages[0]!, {
      ...feeds.reads,
      readChunk: async (address, options) => {
        if (options?.signal) {
          signals.push(options.signal);
        }
        await held;
        return feeds.reads.readChunk(address);
      },
    });

    click(button('Verify'));
    await waitFor(() => (/Checked 1 of \d+/.test(section()?.textContent ?? '') ? true : null));
    expect(section()?.textContent).toMatch(/Checked 1 of (4|8)/);

    click(button('Stop'));

    expect(signals.length).toBeGreaterThan(0);
    expect(signals.every((signal) => signal.aborted)).toBe(true);
    expect(queryButton('Verify')).toBeTruthy();
    expect(section()?.textContent).not.toContain('Checked');
    release();
  });

  it('reads the chat and the own feed again on a second click', async () => {
    const [a, b] = [mine('a'), mine('b')];
    const feeds = await openDetails(a, [a], [a]);
    await verify();
    expect(section()?.textContent).not.toContain("in this chat but not in the sender's own feed");

    feeds.chat(SERVER_KEY, CHAT_TOPIC, [a, b]);
    const shown = await verify();

    expect(shown.textContent).toContain("1 message is in this chat but not in the sender's own feed");
  });

  it("says in one line when the source does not serve the sender's own feed", async () => {
    const a = mine('a');
    const feeds = servedFeeds();
    feeds.chat(SERVER_KEY, CHAT_TOPIC, [a]);
    feeds.ownFeed(SENDER_KEY, CHAT_TOPIC, [a]);
    const refused: SwarmAnswer = {
      kind: 'unavailable',
      cause: { kind: 'network', error: new TypeError('Failed to fetch') },
    };
    await openDetailsOn(feeds, a, {
      ...feeds.reads,
      readFeedHead: async (owner, topic, options) =>
        topic.toHex() === OWN_TOPIC ? refused : feeds.reads.readFeedHead(owner, topic, options),
    });

    const shown = await verify();

    expect(shown.textContent).toContain(
      "This source does not serve the sender's own feed, so it cannot be checked here.",
    );
    expect(shown.textContent).not.toMatch(/Checked|own feed but not in this chat|This message is/);
  });

  it('says the own feed is too large to check when it names far more entries than the sender sent', async () => {
    const a = mine('a');
    await openDetails(a, [a], [a], (feeds) => feeds.ownFeedHeadAt(SENDER_KEY, CHAT_TOPIC, Number.MAX_SAFE_INTEGER));

    const shown = await verify();

    expect(shown.textContent).toContain("The sender's own feed is too large to check.");
  });

  it("says the sender's own feed could not be read when the read of its newest entry fails", async () => {
    const a = mine('a');
    await openDetails(a, [a], [a], (feeds) => {
      for (const key of [...feeds.heads.keys()].filter((head) => head.endsWith(OWN_TOPIC))) {
        feeds.heads.set(key, { kind: 'unavailable', cause: { kind: 'timeout', timeoutMs: 1_000 } });
      }
    });

    const shown = await verify();

    expect(shown.textContent).toContain("The sender's own feed could not be read.");
  });

  it('stops reading the chat and the own feed when the details close', async () => {
    const a = mine('a');
    const feeds = servedFeeds();
    feeds.chat(SERVER_KEY, CHAT_TOPIC, [a]);
    feeds.ownFeed(SENDER_KEY, CHAT_TOPIC, [a]);
    const signals: AbortSignal[] = [];
    let release: () => void = () => {};
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    await openDetailsOn(feeds, a, {
      ...feeds.reads,
      readFeedHead: async (owner, topic, options) => {
        if (comparedTopics.includes(topic.toHex()) && options?.signal) {
          signals.push(options.signal);
        }
        await held;
        return feeds.reads.readFeedHead(owner, topic);
      },
    });
    click(button('Verify'));
    await waitFor(() => (signals.length === 2 ? true : null));

    click(button('Close'));

    expect(signals.every((signal) => signal.aborted)).toBe(true);
    release();
  });

  it('reads the chat afresh for each check, so messages that reached it since an earlier check are not missing', async () => {
    const theirs = signed(OTHER_KEY, 'theirs');
    const [a, b] = [mine('a'), mine('b')];
    const feeds = servedFeeds();
    feeds.chat(SERVER_KEY, CHAT_TOPIC, [theirs, a]);
    feeds.ownFeed(SENDER_KEY, CHAT_TOPIC, [a]);
    feeds.ownFeed(OTHER_KEY, CHAT_TOPIC, [theirs]);
    reads = feeds.reads;
    await watchPage(BATCH, ON_THIS_SERVER);
    await act(async () => FakeSwarmChat.latest().emitter.emit(EVENTS.MESSAGE_RECEIVED, messageData(theirs, 0)));
    await act(async () => FakeSwarmChat.latest().emitter.emit(EVENTS.MESSAGE_RECEIVED, messageData(a, 1)));
    await waitFor(() => (chatRegion()?.textContent?.includes(a.text) ? true : null));
    const details = () =>
      [...document.querySelectorAll('button')].filter(
        (shown) => shown.getAttribute('aria-label') === 'Sent with their own stamp, show details',
      );

    click(details()[0]!);
    await verify();
    click(button('Close'));
    feeds.chat(SERVER_KEY, CHAT_TOPIC, [theirs, a, b]);
    feeds.ownFeed(SENDER_KEY, CHAT_TOPIC, [a, b]);
    click(details()[1]!);
    const shown = await verify();

    expect(shown.querySelector('[aria-label="Missing from the chat feed"]')).toBeNull();
    expect(shown.querySelector(`[aria-label="Missing from the sender's own feed"]`)).toBeNull();
  });

  it('says in one line that the sender has no own feed in this chat when none is found', async () => {
    const a = mine('a');
    await openDetails(a, [a], null);

    const shown = await verify();

    expect(resultLines(shown)[0]).toBe('The sender has no own feed in this chat.');
    expect(shown.textContent).not.toMatch(/keeps (no|none)/);
  });

  describe('under a message the viewer sent', () => {
    /** The viewer's messages, signed by the chat key the fake Swarm ID gives this site, on their own stamp. */
    async function viewers(labels: string[]): Promise<ChatMessage[]> {
      const key = await chatKeyFor(BOUND_SITE);
      return labels.map((label) => signed(key, label));
    }

    /** Opens the details of the viewer's `shown`, in a chat holding `chatMessages` and their own feed holding `copies`. */
    async function openViewersDetails(
      shown: ChatMessage,
      chatMessages: ChatMessage[],
      copies: ChatMessage[] | null,
      arrange: (feeds: ReturnType<typeof servedFeeds>, viewersKey: string) => void = () => {},
    ) {
      const key = await chatKeyFor(BOUND_SITE);
      const feeds = servedFeeds();
      feeds.chat(SERVER_KEY, CHAT_TOPIC, chatMessages);
      if (copies) {
        feeds.ownFeed(key, CHAT_TOPIC, copies);
      }
      arrange(feeds, key);
      await openDetailsOn(feeds, shown);
    }

    const ownFeedHeadAnswers = (answer: SwarmAnswer) => (feeds: ReturnType<typeof servedFeeds>) => {
      for (const key of [...feeds.heads.keys()].filter((head) => head.endsWith(OWN_TOPIC))) {
        feeds.heads.set(key, answer);
      }
    };

    it('says this message is in your own feed when the chat and your own feed agree', async () => {
      const [a, b] = await viewers(['a', 'b']);
      await openViewersDetails(b!, [a!, b!], [a!, b!]);

      const shown = await verify();

      expect(resultLines(shown)).toEqual(['This message is in your own feed.']);
    });

    it('names what each side lacks as yours, each count with the verb its number needs', async () => {
      const [a, b, c, d, e] = await viewers(['a', 'b', 'c', 'd', 'e']);
      await openViewersDetails(c!, [a!, b!, c!], [a!, b!, d!, e!]);

      const shown = await verify();

      expect(resultLines(shown)).toEqual([
        'This message is not in your own feed.',
        '1 message is in this chat but not in your own feed',
        '2 messages are in your own feed but not in this chat',
      ]);
      expect(listed('Missing from your own feed')).toEqual([c!.text]);
    });

    it.each([
      ['one of them', 1, '1 message carries your address, but its signature does not match'],
      ['two of them', 2, '2 messages carry your address, but their signatures do not match'],
    ])(
      'names the messages carrying your address whose signature does not match, %s',
      async (_count, forgedCount, line) => {
        const [a, b, c] = await viewers(['a', 'b', 'c']);
        const forged = [b!, c!].slice(0, forgedCount).map((message) => ({ ...message, text: 'changed after signing' }));
        await openViewersDetails(a!, [a!, ...forged], [a!]);

        const shown = await verify();

        expect(shown.textContent).toContain(line);
      },
    );

    it('says you have no own feed in this chat when none is found', async () => {
      const [a] = await viewers(['a']);
      await openViewersDetails(a!, [a!], null);

      const shown = await verify();

      expect(resultLines(shown)[0]).toBe('You have no own feed in this chat.');
    });

    it.each([
      [
        'the source refuses it',
        ownFeedHeadAnswers({ kind: 'unavailable', cause: { kind: 'status', status: 403 } }),
        'This source does not serve your own feed, so it cannot be checked here.',
      ],
      [
        'a read of it fails',
        ownFeedHeadAnswers({ kind: 'unavailable', cause: { kind: 'timeout', timeoutMs: 1_000 } }),
        'Your own feed could not be read.',
      ],
      [
        'it names far more entries than you sent',
        (feeds: ReturnType<typeof servedFeeds>, viewersKey: string) =>
          feeds.ownFeedHeadAt(viewersKey, CHAT_TOPIC, Number.MAX_SAFE_INTEGER),
        'Your own feed is too large to check.',
      ],
    ] as const)('says in one line about your own feed when %s', async (_why, arrange, line) => {
      const [a] = await viewers(['a']);
      await openViewersDetails(a!, [a!], [a!], arrange);

      const shown = await verify();

      expect(shown.textContent).toContain(line);
    });
  });
});

describe('my own feed in My Swarm', () => {
  const SERVER_KEY = 'c3'.repeat(32);
  const CHAT_TOPIC = 'chat-stream-one';
  const ON_THIS_SERVER = { ...CHAT, feedOwner: `0x${addressOf(SERVER_KEY)}` };
  const ownTopic = Topic.fromString(ownFeedTopic(CHAT_TOPIC));
  const ownSlot = (index: number) => makeFeedIdentifier(ownTopic, FeedIndex.fromBigInt(BigInt(index))).toHex();

  /** My messages, signed by the chat key the fake Swarm ID gives this site. */
  async function myMessages(labels: string[]): Promise<ChatMessage[]> {
    const key = await chatKeyFor(BOUND_SITE);
    return labels.map(
      (label) =>
        createChatMessage(key, {
          id: idOf(label),
          topic: CHAT_TOPIC,
          type: MessageType.TEXT,
          text: `text of ${label}`,
          name: 'Ida',
          ts: 1_000,
          via: MessageVia.OWN_STAMP,
        }).message,
    );
  }

  /** The watch page on my own stamp, a chat holding `chatMessages`, and my own feed holding `copies`, in My Swarm. */
  async function openMySwarm(
    chatMessages: ChatMessage[],
    copies: ChatMessage[],
    arrange: (feeds: ReturnType<typeof servedFeeds>, myKey: string) => void = () => {},
  ) {
    const feeds = servedFeeds();
    feeds.chat(SERVER_KEY, CHAT_TOPIC, chatMessages);
    feeds.ownFeed(await chatKeyFor(BOUND_SITE), CHAT_TOPIC, copies);
    arrange(feeds, await chatKeyFor(BOUND_SITE));
    reads = feeds.reads;
    chatOnMyBeeNode();
    saveChatStampChoice(signedInAddress, { payWith: MessageVia.OWN_STAMP });
    await watchPage(BATCH, ON_THIS_SERVER);
    click(button(/^(My Swarm|Ida|Ada)/));
    await settle();
    const box = () => document.querySelector<HTMLElement>('[aria-label="Own feed in this chat"]');
    await waitFor(() => (box() && !box()?.textContent?.includes('Counting…') ? true : null));
    return box;
  }

  it('says Counting… while it reads the chat and my own feed', async () => {
    const [a] = await myMessages(['a']);
    const feeds = servedFeeds();
    feeds.chat(SERVER_KEY, CHAT_TOPIC, [a!]);
    let release: () => void = () => {};
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    reads = {
      ...feeds.reads,
      readFeedHead: async (...asked) => {
        await held;
        return feeds.reads.readFeedHead(...asked);
      },
    };
    chatOnMyBeeNode();
    saveChatStampChoice(signedInAddress, { payWith: MessageVia.OWN_STAMP });
    await watchPage(BATCH, ON_THIS_SERVER);
    click(button(/^(My Swarm|Ida|Ada)/));
    await settle();
    const box = () => document.querySelector<HTMLElement>('[aria-label="Own feed in this chat"]');
    expect(box()?.textContent).toBe('Counting…');

    release();
    await waitFor(() => (box()?.textContent?.includes('Own feed: 0 of 1 message') ? true : null));
  });

  it('counts my messages in the whole chat against my own feed, and says how many are missing', async () => {
    const [a, b, c] = await myMessages(['a', 'b', 'c']);
    const box = await openMySwarm([a!, b!, c!], [a!]);

    expect(box()?.textContent).toContain('Own feed: 1 of 3 messages');
    expect(box()?.textContent).toContain('2 missing');
    expect(button('Sync')).toBeTruthy();
  });

  it('says my own feed is too large to count, and offers no sync, when it names far more entries than I sent', async () => {
    const [a] = await myMessages(['a']);
    const box = await openMySwarm([a!], [a!], (feeds, myKey) =>
      feeds.ownFeedHeadAt(myKey, CHAT_TOPIC, Number.MAX_SAFE_INTEGER),
    );

    expect(box()?.textContent).toContain('Your own feed is too large to count.');
    expect(queryButton('Sync')).toBeNull();
  });

  it('offers no sync for a copy written past the head the source still serves', async () => {
    const [a, b, c] = await myMessages(['a', 'b', 'c']);
    const box = await openMySwarm([a!, b!, c!], [a!, b!, c!], (feeds, myKey) =>
      feeds.ownFeedHeadAt(myKey, CHAT_TOPIC, 1),
    );

    expect(box()?.textContent).toContain('Own feed: 3 of 3 messages');
    expect(queryButton('Sync')).toBeNull();
  });

  it('says so when the source does not serve my own feed, and offers no sync', async () => {
    const [a] = await myMessages(['a']);
    const box = await openMySwarm([a!], [a!], (feeds) => {
      for (const key of [...feeds.heads.keys()].filter((head) => head.endsWith(ownTopic.toHex()))) {
        feeds.heads.set(key, { kind: 'unavailable', cause: { kind: 'status', status: 403 } });
      }
    });

    expect(box()?.textContent).toContain('This source does not serve your own feed, so it cannot be counted here.');
    expect(queryButton('Sync')).toBeNull();
  });

  it('reads my own feed again when I press Try again after the source refused it', async () => {
    const [a] = await myMessages(['a']);
    let served: ReturnType<typeof servedFeeds> | null = null;
    const box = await openMySwarm([a!], [a!], (feeds) => {
      served = feeds;
      for (const key of [...feeds.heads.keys()].filter((head) => head.endsWith(ownTopic.toHex()))) {
        feeds.heads.set(key, { kind: 'unavailable', cause: { kind: 'status', status: 403 } });
      }
    });
    expect(box()?.textContent).toContain('does not serve your own feed');

    served!.ownFeed(await chatKeyFor(BOUND_SITE), CHAT_TOPIC, [a!]);
    click(button('Try again'));

    await waitFor(() => (box()?.textContent?.includes('Own feed: 1 of 1 message') ? true : null));
  });

  it('counts only my messages on my own stamp, and syncs none the gateway paid for', async () => {
    const [a, b] = await myMessages(['a', 'b']);
    const key = await chatKeyFor(BOUND_SITE);
    const free = createChatMessage(key, {
      id: idOf('free'),
      topic: CHAT_TOPIC,
      type: MessageType.TEXT,
      text: 'paid by the gateway',
      name: 'Ida',
      ts: 1_000,
      via: MessageVia.GATEWAY,
    }).message;
    const box = await openMySwarm([a!, free, b!], [a!, b!]);

    expect(box()?.textContent).toContain('Own feed: 2 of 2 messages');
    expect(queryButton('Sync')).toBeNull();
  });

  it('says nothing is missing and offers no sync when every message has its copy', async () => {
    const [a, b] = await myMessages(['a', 'b']);
    const box = await openMySwarm([a!, b!], [a!, b!]);

    expect(box()?.textContent).toContain('Own feed: 2 of 2 messages');
    expect(box()?.textContent).not.toContain('missing');
    expect(queryButton('Sync')).toBeNull();
  });

  it('writes the missing copies with my stamp, one after the other, and says when all are copied', async () => {
    const [a, b, c] = await myMessages(['a', 'b', 'c']);
    const box = await openMySwarm([a!, b!, c!], [a!]);
    let release: () => void = () => {};
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const answer = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      await held;
      return answer(input, init);
    }) as typeof fetch;

    click(button('Sync'));
    await waitFor(() => (box()?.textContent?.includes('Syncing… 1 of 2') ? true : null));
    release();
    await waitFor(() => (box()?.textContent?.includes('All 3 copied') ? true : null));

    const copies = posted.filter(({ url }) => url.includes(ownSlot(1)) || url.includes(ownSlot(2)));
    expect(copies).toHaveLength(2);
    expect(copies.every(({ stamp }) => stamp === 'e'.repeat(226))).toBe(true);
  });

  it('stops a sync at the first copy that fails, and says the rest were not copied either', async () => {
    const [a, b, c] = await myMessages(['a', 'b', 'c']);
    const box = await openMySwarm([a!, b!, c!], [a!]);
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const refusing = globalThis.fetch;
    let copyWrites = 0;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === 'POST') {
        copyWrites += 1;
        return new Response('', { status: 503 });
      }
      return refusing(input, init);
    }) as typeof fetch;

    click(button('Sync'));
    await act(async () => vi.advanceTimersByTimeAsync(3 * OWN_COPY_RETRY_MS));
    await waitFor(() => (box()?.textContent?.includes('2 could not be copied') ? true : null));

    expect(copyWrites, "the first copy's three tries, and none for the second").toBe(3);
    globalThis.fetch = refusing;
    vi.useRealTimers();
  });

  it('counts the chat and my own feed again once a sync has finished', async () => {
    const [a, b] = await myMessages(['a', 'b']);
    let served: ReturnType<typeof servedFeeds> | null = null;
    const box = await openMySwarm([a!, b!], [a!], (feeds) => {
      served = feeds;
    });
    const chatHeadReads = () =>
      served!.asked.filter((read) => read.startsWith('head ') && read.endsWith(Topic.fromString(CHAT_TOPIC).toHex()))
        .length;
    const before = chatHeadReads();

    click(button('Sync'));
    await waitFor(() => (box()?.textContent?.includes('All 2 copied') ? true : null));

    expect(chatHeadReads()).toBeGreaterThan(before);
  });

  it('counts again after each message I send has been read back and its copy written, and not before', async () => {
    const [a, b] = await myMessages(['a', 'b']);
    let served: ReturnType<typeof servedFeeds> | null = null;
    const box = await openMySwarm([a!], [a!], (feeds) => {
      served = feeds;
    });
    expect(box()?.textContent).toContain('Own feed: 1 of 1 message');
    const chatHeadReads = () =>
      served!.asked.filter((read) => read.startsWith('head ') && read.endsWith(Topic.fromString(CHAT_TOPIC).toHex()))
        .length;
    const before = chatHeadReads();

    const posts = posted.length;
    await act(async () => FakeSwarmChat.latest().parts?.write?.(new TextEncoder().encode(JSON.stringify(b))));
    await waitFor(() => (posted.length === posts + 2 ? true : null));
    await settle();
    expect(box()?.textContent, 'the copy is written, the message not yet read back').toContain(
      'Own feed: 1 of 1 message',
    );
    expect(chatHeadReads()).toBe(before);

    served!.chat(SERVER_KEY, CHAT_TOPIC, [a!, b!]);
    served!.ownFeed(await chatKeyFor(BOUND_SITE), CHAT_TOPIC, [a!, b!]);
    await act(async () => FakeSwarmChat.latest().emitter.emit(EVENTS.MESSAGE_RECEIVED, messageData(b!, 1)));

    await waitFor(() => (box()?.textContent?.includes('Own feed: 2 of 2 messages') ? true : null));
  });

  it('says how many could not be copied after three tries each, and tries them again when asked', async () => {
    const [a, b] = await myMessages(['a', 'b']);
    const box = await openMySwarm([a!, b!], [a!]);
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const refusing = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) =>
      init?.method === 'POST' ? new Response('', { status: 503 }) : refusing(input, init)) as typeof fetch;

    click(button('Sync'));
    await act(async () => vi.advanceTimersByTimeAsync(3 * OWN_COPY_RETRY_MS));
    await waitFor(() => (box()?.textContent?.includes('1 could not be copied') ? true : null));

    globalThis.fetch = refusing;
    click(button('Try again'));
    await act(async () => vi.advanceTimersByTimeAsync(OWN_COPY_RETRY_MS));
    await waitFor(() => (box()?.textContent?.includes('All 2 copied') ? true : null));
    vi.useRealTimers();
  });
});
