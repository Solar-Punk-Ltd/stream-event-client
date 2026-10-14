// @vitest-environment jsdom
import {
  type ChatBinding,
  ChatMessageError,
  EVENTS,
  type MessageData,
  MessageType,
  MessageVia,
} from '@solarpunkltd/swarm-chat-js';
import { act, createElement, StrictMode, useState, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ChatConfig } from '../../src/config/runtimeConfig';
import { nicknameLogin, type Session } from '../../src/features/chat/auth/login';
import { persistUserSession } from '../../src/features/chat/auth/persistence';
import { Chat, READ_ONLY_PRIVATE_KEY } from '../../src/features/chat/Chat/Chat';
import { LoginButton } from '../../src/features/chat/LoginButton/LoginButton';
import { ChatUserProvider } from '../../src/features/chat/User';
import type { ChatReads } from '../../src/features/chat/chatParts';
import { FakeSwarmChat } from '../helpers/fakeSwarmChat';
import { createMessageVerifier } from '../../src/features/chat/verify/messageVerifier';
import {
  BOUND_SITE,
  CHAT_BINDING,
  chatKeyFor,
  FORK_ACCOUNT,
  GUEST_KEY,
  idOf,
  inThreadPort,
  inThreadVerifier,
  messageData,
  OTHER_SITE,
  OTHER_SITE_BINDING,
  SECOND_GUEST_KEY,
  signedMessage,
} from '../helpers/signedChat';
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

const verifier = vi.hoisted(() => ({ current: null as ReturnType<typeof inThreadVerifier> | null }));

vi.mock('../../src/features/chat/verify/chatVerifier', () => ({
  chatVerifier: () => {
    if (!verifier.current) throw new Error('the test set no verifier');
    return verifier.current;
  },
}));

interface FakePickerProps {
  onEmojiClick: (data: { emoji: string }) => void;
  reactionsDefaultOpen?: boolean;
  autoFocusSearch?: boolean;
}

/** The picker as the library draws it: its reactions bar with a button that shows every emoji, or every emoji. */
function FakePicker({ onEmojiClick, reactionsDefaultOpen = false, autoFocusSearch = false }: FakePickerProps) {
  const [showsReactions, setShowsReactions] = useState(reactionsDefaultOpen);
  const pick = (emoji: string, label: string) =>
    createElement('button', { key: label, type: 'button', onClick: () => onEmojiClick({ emoji }) }, label);
  if (showsReactions) {
    return createElement('div', { className: 'EmojiPickerReact' }, [
      pick('👍', 'react 👍'),
      createElement(
        'button',
        { key: 'all', type: 'button', 'aria-label': 'Show all Emojis', onClick: () => setShowsReactions(false) },
        '+',
      ),
    ]);
  }
  return createElement('div', { className: 'EmojiPickerReact' }, [
    createElement('input', { key: 'search', 'aria-label': 'Search emoji', autoFocus: autoFocusSearch }),
    pick('🎉', 'pick 🎉'),
  ]);
}

vi.mock('emoji-picker-react', () => ({
  default: FakePicker,
  EmojiStyle: { NATIVE: 'native' },
  Theme: { DARK: 'dark' },
}));

const FEED_OWNER = '0x' + 'b'.repeat(40);

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

interface MessageFixture {
  /** A readable label, which the message's id is made from by `idOf`. */
  id: string;
  /** Who signs it, a guest key unless named. */
  key?: string;
  username?: string;
  message?: string;
  type?: MessageType;
  /** The label of the message a reply or a reaction refers to. */
  targetMessageId?: string;
  index?: number;
  timestamp?: number;
  via?: MessageVia;
  binding?: ChatBinding;
}

/** A real v8 message signed by its key, as the library hands it to the page. */
function message(fields: MessageFixture): MessageData {
  clock += 1;
  const signed = signedMessage(fields.id, {
    key: fields.key,
    name: fields.username,
    text: fields.message,
    type: fields.type,
    target: fields.targetMessageId === undefined ? undefined : idOf(fields.targetMessageId),
    ts: clock,
    via: fields.via,
    binding: fields.binding,
  });
  return messageData(signed, fields.index ?? clock, fields.timestamp ?? clock);
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

/** Lets the checks of what was emitted come back from the verifier, which answers in microtasks, as fake timers allow. */
async function checked() {
  await act(async () => {
    for (let turn = 0; turn < 10; turn++) {
      await Promise.resolve();
    }
  });
}

async function emit(event: string, data: unknown, chat = FakeSwarmChat.latest()) {
  act(() => chat.emitter.emit(event, data));
  await checked();
}

function panel(topic = 'stream-one', chat: ChatConfig = CHAT): ReactNode {
  return createElement(ChatUserProvider, null, createElement(Chat, { chat, topic, reads: () => CHAT_READS.reads }));
}

async function open(node: ReactNode = panel()) {
  mounted = mount(node);
  await settle();
  await emit(EVENTS.LOADING_INIT, false);
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
  verifier.current = inThreadVerifier();
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
    await emit(EVENTS.LOADING_INIT, true);
    await emit(EVENTS.ERROR, new Error('the head lookup timed out, opening from slot 0'));
    expect(text()).toContain('Loading the chat');
    expect(text()).not.toContain('The chat cannot be reached right now');
    await emit(EVENTS.LOADING_INIT, false);
    expect(text()).not.toContain('Loading the chat');
    expect(text()).toContain('No messages yet.');
  });

  it('says it is loading until the chat has read its history', async () => {
    mounted = mount(panel());
    await settle();
    await emit(EVENTS.LOADING_INIT, true);
    expect(text()).toContain('Loading the chat');
    await emit(EVENTS.LOADING_INIT, false);
    expect(text()).not.toContain('Loading the chat');
  });

  it('shows messages in the order they were written, whatever order they arrive in', async () => {
    await open();
    const first = message({ id: 'first', timestamp: 10 });
    const second = message({ id: 'second', timestamp: 20 });
    const third = message({ id: 'third', timestamp: 30 });
    await emit(EVENTS.MESSAGE_RECEIVED, third);
    await emit(EVENTS.MESSAGE_RECEIVED, first);
    await emit(EVENTS.MESSAGE_RECEIVED, second);
    expect(messageTexts()).toEqual(['text of first', 'text of second', 'text of third']);
    expect(document.querySelector('.chat-message-name')?.textContent).toBe('Bea');
  });

  it('shows published messages by their place in the chat feed, and one still sending after them', async () => {
    await open();
    await emit(EVENTS.MESSAGE_REQUEST_INITIATED, message({ id: 'sending', index: -1, timestamp: 1 }));
    await emit(EVENTS.MESSAGE_RECEIVED, message({ id: 'later-in-feed', index: 8, timestamp: 100 }));
    await emit(EVENTS.MESSAGE_RECEIVED, message({ id: 'earlier-in-feed', index: 7, timestamp: 200 }));
    expect(messageTexts()).toEqual(['text of earlier-in-feed', 'text of later-in-feed', 'text of sending']);
  });

  it('writes who wrote a message above it, with no initial and nothing floating over the row', async () => {
    await open();
    await emit(EVENTS.MESSAGE_RECEIVED, message({ id: 'm', username: 'Bea' }));
    const row = document.querySelector('.chat-message')!;

    expect(row.querySelector('.chat-message-sender .chat-message-name')?.textContent).toBe('Bea');
    expect(row.firstElementChild?.classList.contains('chat-message-text')).toBe(true);
    expect(row.querySelector('[role="img"]')).toBeNull();
    expect(row.querySelector('.tooltip-anchor')).toBeNull();
  });

  it('puts the viewer own messages on the other side from everyone else', async () => {
    signIn('Ada');
    await open();
    await emit(EVENTS.MESSAGE_RECEIVED, message({ id: 'theirs' }));
    await emit(EVENTS.MESSAGE_RECEIVED, message({ id: 'mine', username: 'Ada', key: session!.privateKey }));
    const [theirs, mine] = [...document.querySelectorAll('.chat-message')];

    expect(theirs.classList.contains('own-message')).toBe(false);
    expect(mine.classList.contains('own-message')).toBe(true);
  });

  it('shows a message once when it arrives twice', async () => {
    await open();
    const once = message({ id: 'once' });
    await emit(EVENTS.MESSAGE_RECEIVED, once);
    await emit(EVENTS.MESSAGE_RECEIVED, once);
    expect(messageTexts()).toEqual(['text of once']);
  });

  it('says in plain words when the chat node cannot be reached, and tries again on request', async () => {
    await open();
    await emit(EVENTS.CRITICAL_ERROR, new Error('Request failed with status code 502 at /soc/…'));
    expect(text()).toContain('The chat cannot be reached right now');
    expect(text()).not.toContain('502');
    click(button('Try again'));
    await settle();
    expect(FakeSwarmChat.instances).toHaveLength(2);
    expect(FakeSwarmChat.instances[0].stop).toHaveBeenCalled();
  });

  it('shows the chat again by itself once the library, which keeps trying, gets through', async () => {
    await open();
    await emit(EVENTS.CRITICAL_ERROR, new Error('opening failed three times'));
    expect(text()).toContain('The chat cannot be reached right now');
    await emit(EVENTS.LOADING_INIT, true);
    expect(text()).toContain('The chat cannot be reached right now');
    await emit(EVENTS.LOADING_INIT, false);
    expect(text()).not.toContain('The chat cannot be reached right now');
    expect(text()).toContain('No messages yet.');
    expect(FakeSwarmChat.instances).toHaveLength(1);
  });

  it('says when the chat is reconnecting or not updating, and nothing once it is live again', async () => {
    await open();
    await emit(EVENTS.MESSAGE_RECEIVED, message({ id: 'm' }));
    await emit(EVENTS.STATUS, 'reconnecting');
    expect(text()).toContain('Reconnecting to the chat');
    expect(messageTexts()).toEqual(['text of m']);
    await emit(EVENTS.STATUS, 'stalled');
    expect(text()).toContain('The chat is not updating right now');
    expect(text()).not.toContain('Reconnecting to the chat');
    await emit(EVENTS.STATUS, 'live');
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
    await emit(EVENTS.CRITICAL_ERROR, new Error('unreachable'));
    click(button('Join chat'));
    type(input('Display name'), 'Ada');
    click(button('Join'));
    await settle();
    expect(FakeSwarmChat.instances).toHaveLength(2);
    await emit(EVENTS.LOADING_INIT, false);
    expect(text()).not.toContain('cannot be reached');
    expect(input('Message')).toBeTruthy();
  });
});

describe('what the chat checks', () => {
  function refusedCount(): string | null | undefined {
    return document.querySelector('.chat-container')?.getAttribute('data-refused-messages');
  }

  it('shows a message only once its signature has been checked off the main thread', async () => {
    const port = inThreadPort();
    const answer = port.postMessage;
    const held: Array<() => void> = [];
    port.postMessage = (request) => held.push(() => answer(request));
    verifier.current = createMessageVerifier(port, { origin: BOUND_SITE, allowLocalHttp: false });
    await open();

    await emit(EVENTS.MESSAGE_RECEIVED, message({ id: 'waits' }));
    expect(messageTexts()).toEqual([]);
    held.forEach((release) => release());
    await checked();
    expect(messageTexts()).toEqual(['text of waits']);
  });

  it('drops a verdict that comes back after the stream changed, shown or refused', async () => {
    const port = inThreadPort();
    const answer = port.postMessage;
    const held: Array<() => void> = [];
    port.postMessage = (request) => held.push(() => answer(request));
    verifier.current = createMessageVerifier(port, { origin: BOUND_SITE, allowLocalHttp: false });
    await open(panel('stream-one'));
    const signed = message({ id: 'refused' });
    await emit(EVENTS.MESSAGE_RECEIVED, message({ id: 'late' }));
    await emit(EVENTS.MESSAGE_RECEIVED, { ...signed, signedMessage: { ...signed.signedMessage, text: 'tampered' } });

    mounted?.render(panel('stream-two'));
    await settle();
    held.forEach((release) => release());
    await checked();

    expect(messageTexts()).toEqual([]);
    expect(document.querySelector('.chat-container')?.getAttribute('data-refused-messages')).toBe('0');
  });

  it('says so when messages cannot be checked in this browser, and shows none of them', async () => {
    const port = inThreadPort();
    port.postMessage = () => port.onerror?.(new Event('error') as ErrorEvent);
    verifier.current = createMessageVerifier(port, { origin: BOUND_SITE, allowLocalHttp: false });
    await open();

    await emit(EVENTS.MESSAGE_RECEIVED, message({ id: 'unchecked' }));
    expect(messageTexts()).toEqual([]);
    expect(text()).toContain('Messages cannot be checked in this browser. Reload to try again.');
  });

  it('draws a message from what was signed, never from the copy beside it', async () => {
    await open();
    const honest = message({ id: 'honest', username: 'Bea', message: 'what Bea signed' });
    const forgedCopy = {
      ...honest,
      id: idOf('forged'),
      message: 'what Mallory wrote',
      username: 'Mallory',
      address: 'f'.repeat(40),
      targetMessageId: idOf('elsewhere'),
    };
    await emit(EVENTS.MESSAGE_RECEIVED, forgedCopy);

    expect(messageTexts()).toEqual(['what Bea signed']);
    expect(document.querySelector('.chat-message-name')?.textContent).toBe('Bea');
    expect(text()).not.toContain('Mallory');
    click(button('Guest, show details'));
    expect(text()).toContain(`0x${honest.signedMessage.addr}`);
    expect(text()).not.toContain('f'.repeat(40));
  });

  it('never shows a message whose text was changed after it was signed, and counts it', async () => {
    await open();
    const honest = message({ id: 'honest' });
    const signed = message({ id: 'tampered' });
    const tampered = { ...signed, message: 'changed', signedMessage: { ...signed.signedMessage, text: 'changed' } };
    await emit(EVENTS.MESSAGE_RECEIVED, honest);
    await emit(EVENTS.MESSAGE_RECEIVED, tampered);
    expect(messageTexts()).toEqual(['text of honest']);
    expect(text()).not.toContain('changed');
    expect(refusedCount()).toBe('1');
  });

  it('never shows a message of the format before, and opens a chat whose history is all of it as an empty chat', async () => {
    await open();
    const current = message({ id: 'current' });
    const { via: _via, own: _own, ...rest } = current.signedMessage;
    const previous = { ...current, id: idOf('previous'), signedMessage: { ...rest, v: 7, id: idOf('previous') } };
    await emit(EVENTS.MESSAGE_RECEIVED, previous);
    expect(messageTexts()).toEqual([]);
    expect(text()).toContain('No messages yet.');
    expect(text()).not.toContain('cannot be reached');
    await emit(EVENTS.MESSAGE_RECEIVED, current);
    expect(messageTexts()).toEqual(['text of current']);
  });

  it("never shows a Swarm ID message whose binding was made for another site, not even as a guest's", async () => {
    await open();
    await emit(
      EVENTS.MESSAGE_RECEIVED,
      messageData(signedMessage('elsewhere', { key: await chatKeyFor(OTHER_SITE), binding: OTHER_SITE_BINDING }), 1),
    );
    expect(messageTexts()).toEqual([]);
    expect(refusedCount()).toBe('1');
  });

  it("checks the viewer's own message while it is still sending", async () => {
    signIn();
    await open();
    const own = message({ id: 'own', key: session!.privateKey, username: 'Ada', index: -1 });
    const forged = { ...own, signedMessage: { ...own.signedMessage, text: 'not what was signed' } };
    await emit(EVENTS.MESSAGE_REQUEST_INITIATED, forged);
    expect(messageTexts()).toEqual([]);
    await emit(EVENTS.MESSAGE_REQUEST_INITIATED, own);
    expect(messageTexts()).toEqual(['text of own']);
    expect(text()).toContain('Sending');
  });
});

describe('who sent a message', () => {
  function sender(): Element {
    const line = document.querySelector('.chat-message .chat-message-sender');
    if (!line) throw new Error('no sender line');
    return line;
  }

  function details(): HTMLElement | null {
    return document.querySelector('[role="region"][aria-label="Details for this message"]');
  }

  async function swarmIdMessage(label: string, fields: Partial<MessageFixture> = {}): Promise<MessageData> {
    return message({ id: label, key: await chatKeyFor(BOUND_SITE), binding: CHAT_BINDING, username: 'Ida', ...fields });
  }

  it('writes the time the message was published after the badge and the stamp, once', async () => {
    await open();
    const at = new Date(2026, 10, 12, 9, 5).getTime();
    await emit(EVENTS.MESSAGE_RECEIVED, message({ id: 'timed', via: MessageVia.OWN_STAMP, timestamp: at }));

    const time = sender().querySelector('time');
    expect(time?.textContent).toBe('09:05');
    expect(time?.getAttribute('dateTime')).toBe(new Date(at).toISOString());
    expect(sender().lastElementChild).toBe(time);
    expect(document.querySelectorAll('.chat-message time')).toHaveLength(1);
  });

  it('writes no time, and still shows the message, when its time is out of range', async () => {
    await open();
    await emit(EVENTS.MESSAGE_RECEIVED, message({ id: 'timeless', timestamp: 8.64e15 + 1 }));
    expect(messageTexts()).toEqual(['text of timeless']);
    expect(sender().querySelector('time')).toBeNull();
  });

  it('marks a guest with a grey outline hexagon after the name, in the guest weight', async () => {
    await open();
    await emit(EVENTS.MESSAGE_RECEIVED, message({ id: 'guest', username: 'Bea' }));

    expect(sender().querySelector('.chat-message-name')?.classList.contains('guest')).toBe(true);
    const badge = button('Guest, show details');
    expect(badge.querySelector('svg.sender-badge-guest')).not.toBeNull();
    expect(queryButton('Sent with their own stamp, show details')).toBeNull();
  });

  it('marks a Swarm ID sender with the filled hexagon and its check, and the name in the accent colour', async () => {
    await open();
    await emit(EVENTS.MESSAGE_RECEIVED, await swarmIdMessage('bound'));

    expect(sender().querySelector('.chat-message-name')?.classList.contains('linked')).toBe(true);
    expect(button('Swarm ID, show details').querySelector('svg.sender-badge-swarm-id')).not.toBeNull();
    expect(queryButton('Guest, show details')).toBeNull();
  });

  it("opens a Swarm ID sender's details from the badge, with the account that vouched for the address", async () => {
    await open();
    const bound = await swarmIdMessage('bound');
    await emit(EVENTS.MESSAGE_RECEIVED, bound);
    click(button('Swarm ID, show details'));

    const card = details();
    expect(card).not.toBeNull();
    const rows = Object.fromEntries(
      [...card!.querySelectorAll('dt')].map((term) => [term.textContent, term.nextElementSibling?.textContent]),
    );
    expect(rows).toEqual({
      Name: 'Ida',
      Identity: 'Swarm ID, confirmed for this chat address',
      'Public address': `0x${bound.address}`,
      Signature: 'matches this text',
      'ID link': 'confirmed by Swarm ID for this site',
      'Swarm ID account': FORK_ACCOUNT,
      Sent: 'by the event gateway',
    });
    expect(document.querySelector('.message-actions.visible')).toBeNull();
  });

  it("opens a guest's details with no ID link and no account, and closes them again", async () => {
    await open();
    const guest = message({ id: 'guest', username: 'Bea' });
    await emit(EVENTS.MESSAGE_RECEIVED, guest);
    click(button('Guest, show details'));

    const card = details()!;
    const terms = [...card.querySelectorAll('dt')].map((term) => term.textContent);
    expect(terms).toEqual(['Name', 'Identity', 'Public address', 'Signature', 'Sent']);
    expect(card.textContent).toContain('Guest, a key this browser keeps');
    expect(card.textContent).toContain(`0x${guest.address}`);

    click(button('Close'));
    expect(details()).toBeNull();
  });

  it('shows a stamp after the badge for a message sent with its own stamp, which opens the same details', async () => {
    await open();
    await emit(EVENTS.MESSAGE_RECEIVED, message({ id: 'stamped', via: MessageVia.OWN_STAMP }));

    const stamp = button('Sent with their own stamp, show details');
    expect(stamp.closest('.chat-message-sender')).toBe(sender());
    expect(stamp.getAttribute('title')).toBe('Own stamp');
    click(stamp);
    expect(details()?.textContent).toContain('with their own stamp');
    expect(document.querySelector('.message-actions.visible')).toBeNull();

    click(button('Guest, show details'));
    expect(details()).toBeNull();
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

    const own = message({ id: 'own', message: 'hello there', username: 'Ada', key: session!.privateKey });
    await emit(EVENTS.MESSAGE_REQUEST_INITIATED, own);
    expect(text()).toContain('Sending');
    await emit(EVENTS.MESSAGE_REQUEST_UPLOADED, own);
    expect(text()).toContain('Sending');
    await emit(EVENTS.MESSAGE_RECEIVED, own);
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

    type(input('Message'), '\u0001'.repeat(500));
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

  it('adds an emoji from the picker opened in place above the field, never in a dialog', async () => {
    signIn();
    await open();
    type(input('Message'), 'party ');
    click(await waitFor(() => queryButton('Show all Emojis')));
    expect(document.querySelector('.reaction-toolbar.expanded')).not.toBeNull();
    click(button('pick 🎉'));
    expect(input('Message').value).toBe('party 🎉');
    expect(dialog()).toBeNull();

    click(button('Close the emoji picker'));
    expect(document.querySelector('.reaction-toolbar.expanded')).toBeNull();
    expect(await waitFor(() => queryButton('react 👍'))).toBeTruthy();
  });

  it('adds an emoji from the bar above the field, without opening the picker', async () => {
    signIn();
    await open();
    type(input('Message'), 'nice ');
    click(await waitFor(() => queryButton('react 👍')));
    expect(input('Message').value).toBe('nice 👍');
    expect(document.querySelector('.reaction-toolbar.expanded')).toBeNull();
    expect(dialog()).toBeNull();
  });

  it('shows a message as sending through a reconnect, and as not sent once the library reports it after', async () => {
    signIn();
    await open();
    const own = message({ id: 'own', username: 'Ada', key: session!.privateKey, index: -1 });
    await emit(EVENTS.MESSAGE_REQUEST_INITIATED, own);
    await emit(EVENTS.STATUS, 'reconnecting');
    expect(text()).toContain('Sending');
    expect(text()).not.toContain('Not sent');
    await emit(EVENTS.STATUS, 'live');
    await emit(EVENTS.MESSAGE_REQUEST_ERROR, own);
    expect(text()).toContain('Not sent');
    expect(button('Retry')).toBeTruthy();
  });

  it('offers a resend for a message not confirmed after a while, but only while the chat is live', async () => {
    signIn();
    await open();
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      const own = message({ id: 'own', username: 'Ada', key: session!.privateKey, index: -1 });
      await emit(EVENTS.MESSAGE_REQUEST_INITIATED, own);
      await emit(EVENTS.MESSAGE_REQUEST_UPLOADED, own);
      await emit(EVENTS.STATUS, 'reconnecting');
      void act(() => vi.advanceTimersByTime(20_000));
      expect(text()).toContain('Sending');
      expect(text()).not.toContain('Not confirmed yet');

      await emit(EVENTS.STATUS, 'live');
      expect(text()).toContain('Not confirmed yet');
      expect(button('Resend')).toBeTruthy();

      await emit(EVENTS.STATUS, 'stalled');
      expect(text()).not.toContain('Not confirmed yet');
    } finally {
      vi.useRealTimers();
    }
  });

  it('says a message did not send and sends it again on retry', async () => {
    signIn();
    await open();
    const chat = FakeSwarmChat.latest();
    const own = message({ id: 'own', username: 'Ada', key: session!.privateKey });
    await emit(EVENTS.MESSAGE_REQUEST_INITIATED, own);
    await emit(EVENTS.MESSAGE_REQUEST_ERROR, own);
    expect(text()).toContain('Not sent');
    click(button('Retry'));
    expect(chat.retrySendMessage).toHaveBeenCalledWith(expect.objectContaining({ id: idOf('own') }));
    await emit(EVENTS.MESSAGE_REQUEST_INITIATED, own);
    expect(text()).not.toContain('Not sent');
  });
});

describe('reactions', () => {
  function reaction(id: string, target: string, emoji: string, key: string, username = 'Someone') {
    return message({ id, type: MessageType.REACTION, targetMessageId: target, message: emoji, key, username });
  }

  it('are counted per person, and a second reaction with the same emoji takes the first back', async () => {
    signIn();
    await open();
    await emit(EVENTS.MESSAGE_RECEIVED, message({ id: 'm' }));
    await emit(EVENTS.MESSAGE_RECEIVED, reaction('r1', 'm', '👍', GUEST_KEY));
    await emit(EVENTS.MESSAGE_RECEIVED, reaction('r2', 'm', '👍', SECOND_GUEST_KEY));
    expect(button('👍 2').getAttribute('aria-pressed')).toBe('false');

    await emit(EVENTS.MESSAGE_RECEIVED, reaction('r3', 'm', '👍', GUEST_KEY));
    expect(button('👍 1')).toBeTruthy();
    await emit(EVENTS.MESSAGE_RECEIVED, reaction('r4', 'm', '👍', SECOND_GUEST_KEY));
    expect(queryButton(/^👍/)).toBeNull();
  });

  it('do not count a reaction whose sending ran out, since nobody else ever saw it', async () => {
    signIn();
    await open();
    await emit(EVENTS.MESSAGE_RECEIVED, message({ id: 'm' }));
    await emit(EVENTS.MESSAGE_RECEIVED, reaction('r1', 'm', '👍', GUEST_KEY));
    const own = reaction('mine', 'm', '👍', session!.privateKey, 'Ada');
    await emit(EVENTS.MESSAGE_REQUEST_INITIATED, { ...own, index: -1 });
    expect(button('👍 2')).toBeTruthy();
    await emit(EVENTS.MESSAGE_REQUEST_ERROR, { ...own, index: -1 });
    expect(button('👍 1').getAttribute('aria-pressed')).toBe('false');
  });

  it('counts two people who chose the same name as two', async () => {
    await open();
    await emit(EVENTS.MESSAGE_RECEIVED, message({ id: 'm' }));
    await emit(EVENTS.MESSAGE_RECEIVED, reaction('r1', 'm', '❤️', GUEST_KEY, 'Sam'));
    await emit(EVENTS.MESSAGE_RECEIVED, reaction('r2', 'm', '❤️', SECOND_GUEST_KEY, 'Sam'));
    expect(button('❤️ 2')).toBeTruthy();
  });

  it('show which reaction is the viewer own, and toggle it', async () => {
    signIn();
    await open();
    const chat = FakeSwarmChat.latest();
    await emit(EVENTS.MESSAGE_RECEIVED, message({ id: 'm' }));
    await emit(EVENTS.MESSAGE_RECEIVED, reaction('r1', 'm', '👍', session!.privateKey, 'Ada'));
    expect(button('👍 1').getAttribute('aria-pressed')).toBe('true');
    click(button('👍 1'));
    await settle();
    expect(chat.sendMessage).toHaveBeenCalledWith('👍', MessageType.REACTION, idOf('m'));
  });

  it('are added from a picker that opens beside the message actions, never in a dialog', async () => {
    signIn();
    await open();
    const chat = FakeSwarmChat.latest();
    await emit(EVENTS.MESSAGE_RECEIVED, message({ id: 'm' }));
    expect(queryButton('Message actions')).toBeNull();

    click(document.querySelector('.chat-message .message')!);
    expect(document.querySelector('.chat-message .message-actions.visible')).not.toBeNull();
    click(button('Add reaction'));
    const picker = await waitFor(() => document.querySelector('.emoji-picker-popover'));
    expect(picker.closest('.chat-message')).toBeNull();
    expect(dialog()).toBeNull();

    click(picker.querySelector('button')!);
    await settle();
    expect(chat.sendMessage).toHaveBeenCalledWith('🎉', MessageType.REACTION, idOf('m'));
    expect(document.querySelector('.emoji-picker-popover')).toBeNull();
  });

  it('close the picker on a press outside it or on Escape, and keep it and the actions open on a press inside', async () => {
    signIn();
    await open();
    await emit(EVENTS.MESSAGE_RECEIVED, message({ id: 'm' }));
    click(document.querySelector('.chat-message .message')!);
    const react = button('Add reaction');
    click(react);
    const picker = await waitFor(() => document.querySelector('.emoji-picker-popover'));

    click(picker.querySelector('input')!);
    expect(document.querySelector('.emoji-picker-popover')).not.toBeNull();
    expect(document.querySelector('.message-actions.visible')).not.toBeNull();

    act(() => {
      document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    });
    expect(document.querySelector('.emoji-picker-popover')).toBeNull();

    click(react);
    await waitFor(() => document.querySelector('.emoji-picker-popover'));
    press(document.body, 'Escape');
    expect(document.querySelector('.emoji-picker-popover')).toBeNull();
    expect(document.activeElement).toBe(react);
  });

  it('move focus into the picker when it is opened from the keyboard', async () => {
    signIn();
    await open();
    await emit(EVENTS.MESSAGE_RECEIVED, message({ id: 'm' }));
    click(document.querySelector('.chat-message .message')!);
    act(() => {
      button('Add reaction').dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 0 }));
    });
    const picker = await waitFor(() => document.querySelector('.emoji-picker-popover'));
    expect(document.activeElement).toBe(picker.querySelector('input'));
  });

  it('show their actions on a click of the message and hide them on another', async () => {
    await open();
    await emit(EVENTS.MESSAGE_RECEIVED, message({ id: 'm' }));
    const bubble = document.querySelector('.chat-message .message')!;
    expect(document.querySelector('.message-actions.visible')).toBeNull();
    click(bubble);
    expect(document.querySelector('.message-actions.visible')).not.toBeNull();
    click(bubble);
    expect(document.querySelector('.message-actions.visible')).toBeNull();
  });

  it('ask a viewer with no name for one instead of sending', async () => {
    await open();
    const chat = FakeSwarmChat.latest();
    await emit(EVENTS.MESSAGE_RECEIVED, message({ id: 'm' }));
    await emit(EVENTS.MESSAGE_RECEIVED, reaction('r1', 'm', '👍', GUEST_KEY));
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
    await emit(EVENTS.MESSAGE_RECEIVED, message({ id: 'parent', message: 'the question' }));
    await emit(
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
    expect(chat.sendMessage).toHaveBeenCalledWith('another answer', MessageType.THREAD, idOf('parent'));

    click(button('Back to the chat'));
    expect(messageTexts()).toEqual(['the question']);
  });

  it('open from the message actions for a viewer with no name, who can read them', async () => {
    await open();
    await emit(EVENTS.MESSAGE_RECEIVED, message({ id: 'parent' }));
    click(document.querySelector('.chat-message .message')!);
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
    await emit(EVENTS.LOADING_INIT, false);
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
    await emit(EVENTS.MESSAGE_RECEIVED, message({ id: 'old' }));
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
    await checked();
    expect(messageTexts()).toEqual([]);
  });

  it('stops a chat once, and a start that finishes after the stop changes nothing on screen', async () => {
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
    expect(first.stop).toHaveBeenCalledTimes(1);
    expect(FakeSwarmChat.latest().settings.infra.chatTopic).toBe('chat-stream-two');
  });

  it('calls a chat unreachable when its start fails', async () => {
    FakeSwarmChat.nextStart = () => Promise.reject(new Error('no gateway'));
    mounted = mount(panel());
    await settle();
    expect(text()).toContain('The chat cannot be reached right now');
  });
});
