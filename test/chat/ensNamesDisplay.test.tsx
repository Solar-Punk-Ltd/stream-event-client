// @vitest-environment jsdom
import { EVENTS, type MessageData, MessageType, MessageVia } from '@solarpunkltd/swarm-chat-js';
import { createChatMessage } from '@solarpunkltd/swarm-chat-js/message';
import { act, createElement, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ChatConfig } from '../../src/config/runtimeConfig';
import { Chat } from '../../src/features/chat/Chat/Chat';
import type { ChatReads } from '../../src/features/chat/chatParts';
import { EnsNamesProvider } from '../../src/features/chat/ens/EnsNames';
import { ChatUserProvider } from '../../src/features/chat/User';
import { ConnectProvider } from '../../src/features/connect/ConnectContext';
import { shortAddress } from '../../src/shared/components/Address/addressText';
import { button, click, mount, type Mounted, settle } from '../helpers/dom';
import { FakeSwarmChat } from '../helpers/fakeSwarmChat';
import { BOUND_SITE, CHAT_BINDING, chatKeyFor, idOf, inThreadVerifier, messageData } from '../helpers/signedChat';
import { withThemeChoice } from '../helpers/themeChoice';
import { FORK_CHAT_WALLET_LINK, LINK_WALLET } from '../helpers/walletLinks';

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

const ENDPOINT = 'https://ethereum-rpc.example.org';
const VERIFIED_TICK = 'Verified ENS name';

const CHAT: ChatConfig = {
  enabled: true,
  readUrl: '/chat-read',
  writeUrl: '/chat-write',
  gsocResourceId: 'd'.repeat(64),
  gsocTopic: 'gsoc-topic',
  feedOwner: '0x' + 'b'.repeat(40),
  pollIntervalMs: 750,
};

const CHAT_READS: ChatReads = {
  readFeedHead: async () => ({ kind: 'not-found', serverTimeMs: null }),
  readChunk: async () => ({ kind: 'not-found', serverTimeMs: null }),
  readBytes: async () => ({ kind: 'not-found', serverTimeMs: null }),
};

let mounted: Mounted | null = null;
let asked: string[] = [];

/** A lookup that answers from a table, as the library would after reading the chain. */
function resolverOf(names: Record<string, string>) {
  return async (wallet: string) => {
    asked.push(wallet);
    return names[wallet];
  };
}

function panel(rpcUrl: string | null, names: Record<string, string>): ReactNode {
  return withThemeChoice(
    createElement(
      EnsNamesProvider,
      { rpcUrl, resolve: resolverOf(names) },
      createElement(
        ChatUserProvider,
        null,
        createElement(
          ConnectProvider,
          null,
          createElement(Chat, { chat: CHAT, topic: 'stream-one', reads: () => CHAT_READS }),
        ),
      ),
    ),
  );
}

async function checked() {
  await act(async () => {
    for (let turn = 0; turn < 10; turn++) {
      await Promise.resolve();
    }
  });
}

async function emit(event: string, data: unknown) {
  act(() => FakeSwarmChat.latest().emitter.emit(event, data));
  await checked();
}

async function open(node: ReactNode) {
  mounted = mount(node);
  await settle();
  await emit(EVENTS.LOADING_INIT, false);
}

/** A Swarm ID message signed in as Ida, carrying her wallet link unless told otherwise. */
async function idaSays(label: string, { withWalletLink = true } = {}): Promise<MessageData> {
  const signed = createChatMessage(await chatKeyFor(BOUND_SITE), {
    id: idOf(label),
    topic: 'chat-stream-one',
    type: MessageType.TEXT,
    text: `text of ${label}`,
    name: 'Ida',
    ts: 1_000,
    via: MessageVia.GATEWAY,
    idb: CHAT_BINDING,
    ...(withWalletLink ? { wl: FORK_CHAT_WALLET_LINK } : {}),
  }).message;
  return messageData(signed, 1, 1_000);
}

function senderLine(): Element {
  const line = document.querySelector('.chat-message .chat-message-sender');
  if (!line) throw new Error('no sender line');
  return line;
}

function senderName(): string {
  return senderLine().querySelector('.chat-message-name')?.textContent ?? '';
}

function details(): HTMLElement {
  const card = document.querySelector<HTMLElement>('[role="region"][aria-label="Details for this message"]');
  if (!card) throw new Error('no details card');
  return card;
}

function detailRows(): Record<string, string> {
  return Object.fromEntries(
    [...details().querySelectorAll('dt')].map((term) => [term.textContent, term.nextElementSibling?.textContent ?? '']),
  );
}

beforeEach(() => {
  FakeSwarmChat.reset();
  verifier.current = inThreadVerifier();
  localStorage.clear();
  asked = [];
});

afterEach(() => {
  mounted?.unmount();
  mounted = null;
  document.body.innerHTML = '';
});

describe('a sender with a verified ENS name', () => {
  it('is named by it, with a tick, in place of the name they chose', async () => {
    await open(panel(ENDPOINT, { [LINK_WALLET]: 'ida.eth' }));
    await emit(EVENTS.MESSAGE_RECEIVED, await idaSays('hello'));
    await settle();

    expect(senderName()).toBe('ida.eth');
    expect(senderLine().querySelector(`[aria-label="${VERIFIED_TICK}"]`)).not.toBeNull();
    expect(asked).toEqual([LINK_WALLET]);
  });

  it('heads the details with it, and lists it beside the chosen name and the short wallet address', async () => {
    await open(panel(ENDPOINT, { [LINK_WALLET]: 'ida.eth' }));
    await emit(EVENTS.MESSAGE_RECEIVED, await idaSays('hello'));
    await settle();
    click(button('Swarm ID, show details'));

    expect(details().querySelector('.message-details-title')?.textContent).toBe('ida.eth');
    expect(details().querySelector(`.message-details-title [aria-label="${VERIFIED_TICK}"]`)).not.toBeNull();
    const ens = detailRows().ENS;
    expect(ens).toContain('ida.eth');
    expect(ens).toContain('Chosen name Ida');
    expect(ens).toContain(shortAddress(LINK_WALLET));
    expect(ens).not.toContain('non-Latin');
  });

  it('says so in the details when the name has characters outside ASCII, which can pass for other letters', async () => {
    await open(panel(ENDPOINT, { [LINK_WALLET]: 'іda.eth' }));
    await emit(EVENTS.MESSAGE_RECEIVED, await idaSays('hello'));
    await settle();
    click(button('Swarm ID, show details'));

    expect(detailRows().ENS).toContain('contains non-Latin characters');
  });
});

describe('a name shown beside a message', () => {
  it('is isolated from the text around it, in the sender line and at the head of the details', async () => {
    await open(panel(ENDPOINT, {}));
    await emit(EVENTS.MESSAGE_RECEIVED, await idaSays('hello'));
    await settle();
    click(button('Swarm ID, show details'));

    expect(senderLine().querySelector('.chat-message-name')?.tagName).toBe('BDI');
    expect(details().querySelector('.message-details-title bdi')?.textContent).toBe('Ida');
  });

  it('is marked in the sender line too when the ENS name has characters outside ASCII', async () => {
    await open(panel(ENDPOINT, { [LINK_WALLET]: 'іda.eth' }));
    await emit(EVENTS.MESSAGE_RECEIVED, await idaSays('hello'));
    await settle();

    expect(senderLine().querySelector('[aria-label="contains non-Latin characters"]')).not.toBeNull();
  });

  it('carries no such mark for an ENS name of plain ASCII', async () => {
    await open(panel(ENDPOINT, { [LINK_WALLET]: 'ida.eth' }));
    await emit(EVENTS.MESSAGE_RECEIVED, await idaSays('hello'));
    await settle();

    expect(senderLine().querySelector('[aria-label="contains non-Latin characters"]')).toBeNull();
  });

  it('cuts a long ENS name in the sender line, keeping the whole of it as the title, and shows it whole in the details', async () => {
    const long = `${'a-very-long-name-'.repeat(4)}ida.eth`;
    await open(panel(ENDPOINT, { [LINK_WALLET]: long }));
    await emit(EVENTS.MESSAGE_RECEIVED, await idaSays('hello'));
    await settle();
    click(button('Swarm ID, show details'));

    const name = senderLine().querySelector<HTMLElement>('.chat-message-name');
    expect(name?.classList.contains('ens-name')).toBe(true);
    expect(name?.title).toBe(long);
    expect(details().querySelector('.message-details-title')?.textContent).toBe(long);
  });
});

describe('a sender with no name to show', () => {
  it('keeps the chosen name and no ENS row when the lookup finds none', async () => {
    await open(panel(ENDPOINT, {}));
    await emit(EVENTS.MESSAGE_RECEIVED, await idaSays('hello'));
    await settle();

    expect(senderName()).toBe('Ida');
    expect(senderLine().querySelector(`[aria-label="${VERIFIED_TICK}"]`)).toBeNull();
    click(button('Swarm ID, show details'));
    expect(detailRows()).not.toHaveProperty('ENS');
    expect(details().querySelector('.message-details-title')?.textContent).toBe('Ida');
  });

  it('is never looked up when the deployment names no endpoint', async () => {
    await open(panel(null, { [LINK_WALLET]: 'ida.eth' }));
    await emit(EVENTS.MESSAGE_RECEIVED, await idaSays('hello'));
    await settle();

    expect(senderName()).toBe('Ida');
    expect(asked).toEqual([]);
  });

  it('is never looked up for a message that carries no wallet link', async () => {
    await open(panel(ENDPOINT, { [LINK_WALLET]: 'ida.eth' }));
    await emit(EVENTS.MESSAGE_RECEIVED, await idaSays('hello', { withWalletLink: false }));
    await settle();

    expect(senderName()).toBe('Ida');
    expect(asked).toEqual([]);
  });
});
