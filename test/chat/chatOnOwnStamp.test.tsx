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
import type { SwarmIdPostageBatch } from '../../src/features/chat/swarmId/swarmIdClient';
import { makeFeedIdentifier } from '../../src/shared/feedFollow';
import { chooseSource, defaultRouting } from '../../src/swarm/routing';
import { CHAT, connectPage, seen } from '../helpers/connectPage';
import { wearThemeCss } from '../helpers/themeCss';
import { button, click, nestedLiveRegions, queryButton, settle, type Mounted, waitFor } from '../helpers/dom';
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

describe("a sender's own feed in the message details", () => {
  const SENDER_KEY = 'a1'.repeat(32);
  const SERVER_KEY = 'c3'.repeat(32);
  const CHAT_TOPIC = 'chat-stream-one';
  const ON_THIS_SERVER = { ...CHAT, feedOwner: `0x${addressOf(SERVER_KEY)}` };
  const mine = (label: string) =>
    createChatMessage(SENDER_KEY, {
      id: idOf(label),
      topic: CHAT_TOPIC,
      type: MessageType.TEXT,
      text: `text of ${label}`,
      name: 'Bea',
      ts: 1_000,
      via: MessageVia.OWN_STAMP,
    }).message;

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
    reads = feeds.reads;
    await watchPage(BATCH, ON_THIS_SERVER);
    await act(async () => FakeSwarmChat.latest().emitter.emit(EVENTS.MESSAGE_RECEIVED, messageData(shown, 0)));
    await waitFor(() => (chatRegion()?.textContent?.includes(shown.text) ? true : null));
    click(button('Sent with their own stamp, show details'));
    const section = () => document.querySelector<HTMLElement>('[aria-label="Own feed"]');
    expect(section()?.textContent).toContain('Counting…');
    await waitFor(() => (section()?.textContent?.includes('Counting…') ? null : true));
    return section()!;
  }

  it('says how many messages each feed holds and that this one is in the own feed', async () => {
    const [a, b] = [mine('a'), mine('b')];
    const section = await openDetails(b, [a, b], [a, b]);

    expect(section.textContent).toContain('Own feed: 2 messages');
    expect(section.textContent).toContain('Chat feed: 2 messages');
    expect(section.textContent).toContain('In their own feed');
    expect(section.querySelector('.own-feed-missing')).toBeNull();
  });

  it('names the messages missing on each side, newest first, when the feeds differ', async () => {
    const [a, b, c, d] = ['a', 'b', 'c', 'd'].map(mine) as [ChatMessage, ChatMessage, ChatMessage, ChatMessage];
    const section = await openDetails(c, [a, b, c], [a, d]);

    expect(section.textContent).toContain('Own feed: 2 messages');
    expect(section.textContent).toContain('Chat feed: 3 messages');
    expect(section.textContent).toContain('Not in their own feed');
    const missing = (label: string) =>
      [...section.querySelectorAll(`[aria-label="${label}"] li`)].map((item) => item.textContent);
    expect(missing('Missing from their own feed')).toEqual([c.text, b.text]);
    expect(missing('Missing from the chat feed')).toEqual([d.text]);
  });

  it('says the own feed is too large to count when it names far more entries than the sender sent', async () => {
    const a = mine('a');
    const section = await openDetails(a, [a], [a], (feeds) =>
      feeds.ownFeedHeadAt(SENDER_KEY, CHAT_TOPIC, Number.MAX_SAFE_INTEGER),
    );

    expect(section.textContent).toContain('Their own feed is too large to count.');
  });

  it('stops reading the chat and the own feed when the details close', async () => {
    const a = mine('a');
    const feeds = servedFeeds();
    feeds.chat(SERVER_KEY, CHAT_TOPIC, [a]);
    feeds.ownFeed(SENDER_KEY, CHAT_TOPIC, [a]);
    const comparedTopics = [CHAT_TOPIC, ownFeedTopic(CHAT_TOPIC)].map((topic) => Topic.fromString(topic).toHex());
    const signals: AbortSignal[] = [];
    let release: () => void = () => {};
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    reads = {
      ...feeds.reads,
      readFeedHead: async (owner, topic, options) => {
        if (comparedTopics.includes(topic.toHex()) && options?.signal) {
          signals.push(options.signal);
        }
        await held;
        return feeds.reads.readFeedHead(owner, topic);
      },
    };
    await watchPage(BATCH, ON_THIS_SERVER);
    await act(async () => FakeSwarmChat.latest().emitter.emit(EVENTS.MESSAGE_RECEIVED, messageData(a, 0)));
    await waitFor(() => (chatRegion()?.textContent?.includes(a.text) ? true : null));
    click(button('Sent with their own stamp, show details'));
    await waitFor(() => (signals.length === 2 ? true : null));

    click(button('Close'));

    expect(signals.every((signal) => signal.aborted)).toBe(true);
    release();
  });

  it('says plainly when the sender keeps no own feed', async () => {
    const a = mine('a');
    const section = await openDetails(a, [a], null);

    expect(section.textContent).toContain('No own feed');
    expect(section.textContent).toContain('Chat feed: 1 message');
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
