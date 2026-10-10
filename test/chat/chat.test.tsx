// @vitest-environment jsdom
import { ChatMessageError, EVENTS, MessageType, type MessageData } from '@solarpunkltd/swarm-chat-js';
import { act, createElement, StrictMode, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ChatConfig } from '../../src/config/runtimeConfig';
import { nicknameLogin, type Session } from '../../src/features/chat/auth/login';
import { persistUserSession } from '../../src/features/chat/auth/persistence';
import { Chat, READ_ONLY_PRIVATE_KEY } from '../../src/features/chat/Chat/Chat';
import { LoginButton } from '../../src/features/chat/LoginButton/LoginButton';
import { ChatUserProvider } from '../../src/features/chat/User';
import type { ChatReads } from '../../src/features/chat/chatParts';
import { FakeSwarmChat } from '../helpers/fakeSwarmChat';
import {
  button,
  click,
  dialog,
  input,
  mount,
  press,
  queryButton,
  settle,
  text,
  type,
  type Mounted,
  waitFor,
} from '../helpers/dom';
import { withThemeChoice } from '../helpers/themeChoice';

vi.mock('@solarpunkltd/swarm-chat-js', async (importActual) => {
  const actual = await importActual<typeof import('@solarpunkltd/swarm-chat-js')>();
  const { FakeSwarmChat } = await import('../helpers/fakeSwarmChat');
  return { ...actual, SwarmChat: FakeSwarmChat };
});

vi.mock('emoji-picker-react', () => ({
  default: ({ onEmojiClick }: { onEmojiClick: (data: { emoji: string }) => void }) =>
    createElement('button', { type: 'button', onClick: () => onEmojiClick({ emoji: '🎉' }) }, 'pick 🎉'),
  EmojiStyle: { NATIVE: 'native' },
  Theme: { DARK: 'dark' },
}));

const FEED_OWNER = '0x' + 'b'.repeat(40);
const OTHER = 'c'.repeat(40);

const CHAT: ChatConfig = {
  enabled: true,
  readUrl: '/chat-read',
  writeUrl: '/chat-write',
  gsocResourceId: 'd'.repeat(64),
  gsocTopic: 'gsoc-topic',
  feedOwner: FEED_OWNER,
  pollIntervalMs: 750,
};

let mounted: Mounted | null = null;
let session: Session | null = null;
let clock = 1_000;

function message(fields: Partial<MessageData> & Pick<MessageData, 'id'>): MessageData {
  clock += 1;
  return {
    type: MessageType.TEXT,
    message: `text of ${fields.id}`,
    username: 'Bea',
    address: OTHER,
    timestamp: clock,
    signature: 'sig',
    index: clock,
    chatTopic: 'chat-topic',
    sentAt: clock,
    ...fields,
  };
}

/** What the panel reads the chat through, the Swarm client's chat reader in the app. */
const CHAT_READS = {
  asked: [] as string[],
  reads: {
    readFeedHead: async () => ({ kind: 'not-found', serverTimeMs: null }) as const,
    readChunk: async (address: string) => {
      CHAT_READS.asked.push(address);
      return { kind: 'not-found', serverTimeMs: null } as const;
    },
    readBytes: async () => ({ kind: 'not-found', serverTimeMs: null }) as const,
  } satisfies ChatReads,
};

function emit(event: string, data: unknown, chat = FakeSwarmChat.latest()) {
  act(() => chat.emitter.emit(event, data));
}

function panel(topic = 'stream-one', chat: ChatConfig = CHAT): ReactNode {
  return createElement(ChatUserProvider, null, createElement(Chat, { chat, topic, reads: () => CHAT_READS.reads }));
}

async function open(node: ReactNode = panel()) {
  mounted = mount(node);
  await settle();
  emit(EVENTS.LOADING_INIT, false);
}

function signIn(name = 'Ada') {
  session = nicknameLogin(name);
  persistUserSession(session);
}

function messageTexts(list = document): string[] {
  return [...list.querySelectorAll('.chat-message-text .message')].map((node) => node.textContent ?? '');
}

beforeEach(() => {
  FakeSwarmChat.reset();
  localStorage.clear();
  session = null;
});

afterEach(() => {
  mounted?.unmount();
  mounted = null;
  document.body.innerHTML = '';
});

describe('the chat on a watch page', () => {
  it('reads the stream chat feed that the aggregator writes, by polling at the configured interval', async () => {
    await open();
    const { infra } = FakeSwarmChat.latest().settings;
    expect(infra).toMatchObject({
      beeUrl: '/chat-read',
      writeUrl: '/chat-write',
      gsocResourceId: CHAT.gsocResourceId,
      gsocTopic: 'gsoc-topic',
      chatTopic: 'chat-stream-one',
      chatAddress: FEED_OWNER,
      pollingInterval: 750,
    });
    expect(infra.stamp).toBeUndefined();
  });

  it("hands the library a source over the Swarm client's chat reader and a write of its own", async () => {
    await open();
    CHAT_READS.asked.length = 0;

    const parts = FakeSwarmChat.latest().parts;
    expect(typeof parts?.write).toBe('function');
    expect(await parts?.source?.readSlot(0)).toBeNull();
    expect(CHAT_READS.asked).toHaveLength(1);
  });

  it('reads with a fixed placeholder key when the viewer has no name', async () => {
    await open();
    expect(FakeSwarmChat.latest().settings.user).toEqual({ privateKey: READ_ONLY_PRIVATE_KEY, nickname: '' });
  });

  it('reads and writes with the viewer key once they have a name', async () => {
    signIn('Ada');
    await open();
    expect(FakeSwarmChat.latest().settings.user).toEqual({ privateKey: session?.privateKey, nickname: 'Ada' });
  });

  it('keeps loading through an error the library recovers from while opening, and never calls it unreachable', async () => {
    mounted = mount(panel());
    await settle();
    emit(EVENTS.LOADING_INIT, true);
    emit(EVENTS.ERROR, new Error('the head lookup timed out, opening from slot 0'));
    expect(text()).toContain('Loading the chat');
    expect(text()).not.toContain('The chat cannot be reached right now');
    emit(EVENTS.LOADING_INIT, false);
    expect(text()).not.toContain('Loading the chat');
    expect(text()).toContain('No messages yet.');
  });

  it('says it is loading until the chat has read its history', async () => {
    mounted = mount(panel());
    await settle();
    emit(EVENTS.LOADING_INIT, true);
    expect(text()).toContain('Loading the chat');
    emit(EVENTS.LOADING_INIT, false);
    expect(text()).not.toContain('Loading the chat');
  });

  it('shows messages in the order they were written, whatever order they arrive in', async () => {
    await open();
    const first = message({ id: 'first', timestamp: 10 });
    const second = message({ id: 'second', timestamp: 20 });
    const third = message({ id: 'third', timestamp: 30 });
    emit(EVENTS.MESSAGE_RECEIVED, third);
    emit(EVENTS.MESSAGE_RECEIVED, first);
    emit(EVENTS.MESSAGE_RECEIVED, second);
    expect(messageTexts()).toEqual(['text of first', 'text of second', 'text of third']);
    expect(text()).toContain('Bea');
  });

  it('shows published messages by their place in the chat feed, and one still sending after them', async () => {
    await open();
    emit(EVENTS.MESSAGE_REQUEST_INITIATED, message({ id: 'sending', index: -1, timestamp: 1 }));
    emit(EVENTS.MESSAGE_RECEIVED, message({ id: 'later-in-feed', index: 8, timestamp: 100 }));
    emit(EVENTS.MESSAGE_RECEIVED, message({ id: 'earlier-in-feed', index: 7, timestamp: 200 }));
    expect(messageTexts()).toEqual(['text of earlier-in-feed', 'text of later-in-feed', 'text of sending']);
  });

  it('shows who wrote a message by an initial, with the name and its short address named on it rather than written in the row', async () => {
    await open();
    emit(EVENTS.MESSAGE_RECEIVED, message({ id: 'm', username: 'Bea', address: OTHER }));
    const avatar = document.querySelector('.chat-message [role="img"]');

    expect(avatar?.textContent).toBe('B');
    expect(avatar?.getAttribute('aria-label')).toBe('Bea ccc:ccc');
    expect(document.querySelector('.profile-picture-tooltip')?.textContent).toBe('Bea ccc:ccc');
    expect(document.querySelector('.chat-message-author')).toBeNull();
  });

  it('puts the viewer own messages on the other side from everyone else', async () => {
    signIn('Ada');
    await open();
    emit(EVENTS.MESSAGE_RECEIVED, message({ id: 'theirs' }));
    emit(EVENTS.MESSAGE_RECEIVED, message({ id: 'mine', username: 'Ada', address: session!.address }));
    const [theirs, mine] = [...document.querySelectorAll('.chat-message')];

    expect(theirs.classList.contains('own-message')).toBe(false);
    expect(mine.classList.contains('own-message')).toBe(true);
  });

  it('shows a message once when it arrives twice', async () => {
    await open();
    const once = message({ id: 'once' });
    emit(EVENTS.MESSAGE_RECEIVED, once);
    emit(EVENTS.MESSAGE_RECEIVED, once);
    expect(messageTexts()).toEqual(['text of once']);
  });

  it('says in plain words when the chat node cannot be reached, and tries again on request', async () => {
    await open();
    emit(EVENTS.CRITICAL_ERROR, new Error('Request failed with status code 502 at /soc/…'));
    expect(text()).toContain('The chat cannot be reached right now');
    expect(text()).not.toContain('502');
    click(button('Try again'));
    await settle();
    expect(FakeSwarmChat.instances).toHaveLength(2);
    expect(FakeSwarmChat.instances[0].stop).toHaveBeenCalled();
  });

  it('shows the chat again by itself once the library, which keeps trying, gets through', async () => {
    await open();
    emit(EVENTS.CRITICAL_ERROR, new Error('opening failed three times'));
    expect(text()).toContain('The chat cannot be reached right now');
    emit(EVENTS.LOADING_INIT, true);
    expect(text()).toContain('The chat cannot be reached right now');
    emit(EVENTS.LOADING_INIT, false);
    expect(text()).not.toContain('The chat cannot be reached right now');
    expect(text()).toContain('No messages yet.');
    expect(FakeSwarmChat.instances).toHaveLength(1);
  });

  it('says when the chat is reconnecting or not updating, and nothing once it is live again', async () => {
    await open();
    emit(EVENTS.MESSAGE_RECEIVED, message({ id: 'm' }));
    emit(EVENTS.STATUS, 'reconnecting');
    expect(text()).toContain('Reconnecting to the chat');
    expect(messageTexts()).toEqual(['text of m']);
    emit(EVENTS.STATUS, 'stalled');
    expect(text()).toContain('The chat is not updating right now');
    expect(text()).not.toContain('Reconnecting to the chat');
    emit(EVENTS.STATUS, 'live');
    expect(text()).not.toContain('Reconnecting to the chat');
    expect(text()).not.toContain('The chat is not updating right now');
  });

  it('reads again, and shows the chat once it answers, after a sign-in while it could not be reached', async () => {
    await open(
      withThemeChoice(
        createElement(
          ChatUserProvider,
          null,
          createElement(LoginButton),
          createElement(Chat, { chat: CHAT, topic: 'stream-one', reads: () => CHAT_READS.reads }),
        ),
      ),
    );
    emit(EVENTS.CRITICAL_ERROR, new Error('unreachable'));
    click(button('Join chat'));
    type(input('Display name'), 'Ada');
    click(button('Join'));
    await settle();
    expect(FakeSwarmChat.instances).toHaveLength(2);
    emit(EVENTS.LOADING_INIT, false);
    expect(text()).not.toContain('cannot be reached');
    expect(input('Message')).toBeTruthy();
  });
});

describe('sending', () => {
  it('asks a viewer with no name for one before anything is sent', async () => {
    await open();
    expect(document.querySelector('input[aria-label="Message"]')).toBeNull();
    click(button('Join the chat to send messages'));
    expect(dialog()?.textContent).toContain('Join the chat');
    type(input('Display name'), 'Ada');
    click(button('Join'));
    await settle();
    expect(dialog()).toBeNull();
    expect(input('Message')).toBeTruthy();
    expect(FakeSwarmChat.latest().settings.user.nickname).toBe('Ada');
  });

  it('sends the text, shows it as sending, then as sent', async () => {
    signIn();
    await open();
    const chat = FakeSwarmChat.latest();
    type(input('Message'), '  hello there  ');
    press(input('Message'), 'Enter');
    await settle();
    expect(chat.sendMessage).toHaveBeenCalledWith('hello there', MessageType.TEXT, undefined);
    expect(input('Message').value).toBe('');

    const own = message({ id: 'own', message: 'hello there', username: 'Ada', address: session!.address });
    emit(EVENTS.MESSAGE_REQUEST_INITIATED, own);
    expect(text()).toContain('Sending');
    emit(EVENTS.MESSAGE_REQUEST_UPLOADED, own);
    expect(text()).toContain('Sending');
    emit(EVENTS.MESSAGE_RECEIVED, own);
    expect(text()).not.toContain('Sending');
    expect(messageTexts()).toEqual(['hello there']);
  });

  it('sends with the send button, and not an empty message', async () => {
    signIn();
    await open();
    const chat = FakeSwarmChat.latest();
    type(input('Message'), '   ');
    click(button('Send'));
    await settle();
    expect(chat.sendMessage).not.toHaveBeenCalled();
    type(input('Message'), 'hi');
    click(button('Send'));
    await settle();
    expect(chat.sendMessage).toHaveBeenCalledTimes(1);
  });

  it('counts a message as the chat does, and does not send one the chat would refuse', async () => {
    signIn();
    await open();
    const chat = FakeSwarmChat.latest();
    type(input('Message'), 'a'.repeat(500));
    expect(button('Send').disabled).toBe(false);
    expect(text()).not.toContain('at most 500 characters');

    type(input('Message'), 'a'.repeat(501));
    expect(button('Send').disabled).toBe(true);
    expect(text()).toContain('A message is at most 500 characters.');
    press(input('Message'), 'Enter');
    await settle();
    expect(chat.sendMessage).not.toHaveBeenCalled();

    type(input('Message'), '🐝'.repeat(400));
    expect(button('Send').disabled).toBe(false);

    type(input('Message'), '🐝'.repeat(500));
    expect(button('Send').disabled).toBe(true);
    expect(text()).toContain('This message is too long to send.');
    expect(text()).not.toContain('at most 500 characters');
  });

  it('says why when the chat refuses a message', async () => {
    signIn();
    await open();
    const chat = FakeSwarmChat.latest();
    chat.sendMessage.mockRejectedValueOnce(new ChatMessageError('too-large', 'over the cap'));
    type(input('Message'), 'hi');
    click(button('Send'));
    await settle();
    expect(text()).toContain('This message is too long to send.');
    expect(input('Message').value).toBe('hi');
  });

  it('adds an emoji from the picker to the message being written', async () => {
    signIn();
    await open();
    type(input('Message'), 'party ');
    click(button('Add an emoji'));
    click(await waitFor(() => queryButton('pick 🎉')));
    expect(input('Message').value).toBe('party 🎉');
    expect(dialog()).toBeNull();
  });

  it('adds a quick emoji to the message being written, without opening the picker', async () => {
    signIn();
    await open();
    type(input('Message'), 'nice ');
    click(button('Add 👍'));
    expect(input('Message').value).toBe('nice 👍');
    expect(dialog()).toBeNull();
  });

  it('shows a message as sending through a reconnect, and as not sent once the library reports it after', async () => {
    signIn();
    await open();
    const own = message({ id: 'own', username: 'Ada', address: session!.address, index: -1 });
    emit(EVENTS.MESSAGE_REQUEST_INITIATED, own);
    emit(EVENTS.STATUS, 'reconnecting');
    expect(text()).toContain('Sending');
    expect(text()).not.toContain('Not sent');
    emit(EVENTS.STATUS, 'live');
    emit(EVENTS.MESSAGE_REQUEST_ERROR, own);
    expect(text()).toContain('Not sent');
    expect(button('Retry')).toBeTruthy();
  });

  it('offers a resend for a message not confirmed after a while, but only while the chat is live', async () => {
    signIn();
    await open();
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      const own = message({ id: 'own', username: 'Ada', address: session!.address, index: -1 });
      emit(EVENTS.MESSAGE_REQUEST_INITIATED, own);
      emit(EVENTS.MESSAGE_REQUEST_UPLOADED, own);
      emit(EVENTS.STATUS, 'reconnecting');
      void act(() => vi.advanceTimersByTime(20_000));
      expect(text()).toContain('Sending');
      expect(text()).not.toContain('Not confirmed yet');

      emit(EVENTS.STATUS, 'live');
      expect(text()).toContain('Not confirmed yet');
      expect(button('Resend')).toBeTruthy();

      emit(EVENTS.STATUS, 'stalled');
      expect(text()).not.toContain('Not confirmed yet');
    } finally {
      vi.useRealTimers();
    }
  });

  it('says a message did not send and sends it again on retry', async () => {
    signIn();
    await open();
    const chat = FakeSwarmChat.latest();
    const own = message({ id: 'own', username: 'Ada', address: session!.address });
    emit(EVENTS.MESSAGE_REQUEST_INITIATED, own);
    emit(EVENTS.MESSAGE_REQUEST_ERROR, own);
    expect(text()).toContain('Not sent');
    click(button('Retry'));
    expect(chat.retrySendMessage).toHaveBeenCalledWith(expect.objectContaining({ id: 'own' }));
    emit(EVENTS.MESSAGE_REQUEST_INITIATED, own);
    expect(text()).not.toContain('Not sent');
  });
});

describe('reactions', () => {
  function reaction(id: string, target: string, emoji: string, address: string, username = 'Someone') {
    return message({ id, type: MessageType.REACTION, targetMessageId: target, message: emoji, address, username });
  }

  it('are counted per person, and a second reaction with the same emoji takes the first back', async () => {
    signIn();
    await open();
    emit(EVENTS.MESSAGE_RECEIVED, message({ id: 'm' }));
    emit(EVENTS.MESSAGE_RECEIVED, reaction('r1', 'm', '👍', OTHER));
    emit(EVENTS.MESSAGE_RECEIVED, reaction('r2', 'm', '👍', 'e'.repeat(40)));
    expect(button('👍 2').getAttribute('aria-pressed')).toBe('false');

    emit(EVENTS.MESSAGE_RECEIVED, reaction('r3', 'm', '👍', OTHER));
    expect(button('👍 1')).toBeTruthy();
    emit(EVENTS.MESSAGE_RECEIVED, reaction('r4', 'm', '👍', 'e'.repeat(40)));
    expect(queryButton(/^👍/)).toBeNull();
  });

  it('do not count a reaction whose sending ran out, since nobody else ever saw it', async () => {
    signIn();
    await open();
    emit(EVENTS.MESSAGE_RECEIVED, message({ id: 'm' }));
    emit(EVENTS.MESSAGE_RECEIVED, reaction('r1', 'm', '👍', OTHER));
    const own = reaction('mine', 'm', '👍', session!.address, 'Ada');
    emit(EVENTS.MESSAGE_REQUEST_INITIATED, { ...own, index: -1 });
    expect(button('👍 2')).toBeTruthy();
    emit(EVENTS.MESSAGE_REQUEST_ERROR, { ...own, index: -1 });
    expect(button('👍 1').getAttribute('aria-pressed')).toBe('false');
  });

  it('counts two people who chose the same name as two', async () => {
    await open();
    emit(EVENTS.MESSAGE_RECEIVED, message({ id: 'm' }));
    emit(EVENTS.MESSAGE_RECEIVED, reaction('r1', 'm', '❤️', OTHER, 'Sam'));
    emit(EVENTS.MESSAGE_RECEIVED, reaction('r2', 'm', '❤️', 'e'.repeat(40), 'Sam'));
    expect(button('❤️ 2')).toBeTruthy();
  });

  it('show which reaction is the viewer own, and toggle it', async () => {
    signIn();
    await open();
    const chat = FakeSwarmChat.latest();
    emit(EVENTS.MESSAGE_RECEIVED, message({ id: 'm' }));
    emit(EVENTS.MESSAGE_RECEIVED, reaction('r1', 'm', '👍', session!.address, 'Ada'));
    expect(button('👍 1').getAttribute('aria-pressed')).toBe('true');
    click(button('👍 1'));
    await settle();
    expect(chat.sendMessage).toHaveBeenCalledWith('👍', MessageType.REACTION, 'm');
  });

  it('are added from the message actions', async () => {
    signIn();
    await open();
    const chat = FakeSwarmChat.latest();
    emit(EVENTS.MESSAGE_RECEIVED, message({ id: 'm' }));
    click(button('Message actions'));
    click(button('React with 😂'));
    await settle();
    expect(chat.sendMessage).toHaveBeenCalledWith('😂', MessageType.REACTION, 'm');
  });

  it('ask a viewer with no name for one instead of sending', async () => {
    await open();
    const chat = FakeSwarmChat.latest();
    emit(EVENTS.MESSAGE_RECEIVED, message({ id: 'm' }));
    emit(EVENTS.MESSAGE_RECEIVED, reaction('r1', 'm', '👍', OTHER));
    click(button('👍 1'));
    expect(chat.sendMessage).not.toHaveBeenCalled();
    expect(dialog()?.textContent).toContain('Join the chat');
  });
});

describe('threads', () => {
  it('count the replies under a message and open them, with the reply sent into the thread', async () => {
    signIn();
    await open();
    const chat = FakeSwarmChat.latest();
    emit(EVENTS.MESSAGE_RECEIVED, message({ id: 'parent', message: 'the question' }));
    emit(
      EVENTS.MESSAGE_RECEIVED,
      message({ id: 'reply', type: MessageType.THREAD, targetMessageId: 'parent', message: 'an answer' }),
    );
    expect(messageTexts()).toEqual(['the question']);

    click(button('1 reply'));
    expect(text()).toContain('Thread');
    expect(messageTexts()).toEqual(['the question', 'an answer']);

    type(input('Reply'), 'another answer');
    click(button('Send'));
    await settle();
    expect(chat.sendMessage).toHaveBeenCalledWith('another answer', MessageType.THREAD, 'parent');

    click(button('Back to the chat'));
    expect(messageTexts()).toEqual(['the question']);
  });

  it('open from the message actions for a viewer with no name, who can read them', async () => {
    await open();
    emit(EVENTS.MESSAGE_RECEIVED, message({ id: 'parent' }));
    click(button('Message actions'));
    click(button('Reply in a thread'));
    expect(text()).toContain('No replies yet');
    expect(queryButton('Join the chat to reply')).toBeTruthy();
  });
});

describe('older messages', () => {
  it('are offered when the chat has more, and fetched on request', async () => {
    mounted = mount(panel());
    await settle();
    const chat = FakeSwarmChat.latest();
    chat.previousMessages = true;
    emit(EVENTS.LOADING_INIT, false);
    click(button('Load older messages'));
    await settle();
    expect(chat.fetchPreviousMessages).toHaveBeenCalledTimes(1);
  });

  it('are not offered when there are none', async () => {
    await open();
    expect(queryButton('Load older messages')).toBeNull();
  });
});

describe('the chat lifecycle', () => {
  it('starts one chat under StrictMode, which mounts every effect twice', async () => {
    mounted = mount(createElement(StrictMode, null, panel()));
    await settle();
    expect(FakeSwarmChat.instances).toHaveLength(1);
    expect(FakeSwarmChat.latest().start).toHaveBeenCalledTimes(1);
  });

  it('stops the chat when the panel goes away', async () => {
    await open();
    const chat = FakeSwarmChat.latest();
    mounted?.unmount();
    mounted = null;
    expect(chat.stop).toHaveBeenCalledTimes(1);
  });

  it('takes its own listeners off the chat it stops, since the library keeps them through a stop', async () => {
    await open(panel('stream-one'));
    const first = FakeSwarmChat.latest();
    expect(first.emitter.listenerCount()).toBeGreaterThan(0);
    mounted?.render(panel('stream-two'));
    await settle();
    expect(first.emitter.listenerCount()).toBe(0);
    const second = FakeSwarmChat.latest();
    mounted?.unmount();
    mounted = null;
    expect(second.emitter.listenerCount()).toBe(0);
  });

  it('stops the old chat and starts the new stream chat when the stream changes, dropping the old messages', async () => {
    await open(panel('stream-one'));
    const first = FakeSwarmChat.latest();
    emit(EVENTS.MESSAGE_RECEIVED, message({ id: 'old' }));
    mounted?.render(panel('stream-two'));
    await settle();
    expect(first.stop).toHaveBeenCalled();
    expect(FakeSwarmChat.instances).toHaveLength(2);
    expect(FakeSwarmChat.latest().settings.infra.chatTopic).toBe('chat-stream-two');
    expect(messageTexts()).toEqual([]);
  });

  it('ignores anything the old chat still says after it was stopped', async () => {
    await open(panel('stream-one'));
    const first = FakeSwarmChat.latest();
    const leftover = first.emitter.emit;
    mounted?.render(panel('stream-two'));
    await settle();
    act(() => leftover('messageReceived', message({ id: 'late' })));
    expect(messageTexts()).toEqual([]);
  });

  it('stops again a chat whose start finished after it had been stopped, so its polling does not outlive it', async () => {
    let finishStart: () => void = () => {};
    FakeSwarmChat.nextStart = () =>
      new Promise<void>((resolve) => {
        finishStart = resolve;
      });
    mounted = mount(panel('stream-one'));
    await settle();
    const first = FakeSwarmChat.latest();
    mounted.render(panel('stream-two'));
    await settle();
    expect(first.stop).toHaveBeenCalledTimes(1);
    finishStart();
    await settle();
    expect(first.stop).toHaveBeenCalledTimes(2);
  });
});
