// @vitest-environment jsdom
import { act, createElement } from 'react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ChatConfig } from '../../src/config/runtimeConfig';
import { StreamWatcher } from '../../src/features/player/StreamWatcher/StreamWatcher';
import { ChatUserProvider } from '../../src/features/chat/User';
import { FakeSwarmChat } from '../helpers/fakeSwarmChat';
import { mount, settle, text, waitFor, type Mounted } from '../helpers/dom';

vi.mock('@solarpunkltd/swarm-chat-js', async (importActual) => {
  const actual = await importActual<typeof import('@solarpunkltd/swarm-chat-js')>();
  const { FakeSwarmChat } = await import('../helpers/fakeSwarmChat');
  return { ...actual, SwarmChat: FakeSwarmChat };
});

const appContext = vi.hoisted(() => ({
  value: {
    streamList: [],
    isStreamListLoaded: true,
    chat: null as ChatConfig | null,
    swarm: { ownPlayer: () => null },
  },
}));

vi.mock('../../src/app/AppProvider', () => ({ useAppContext: () => appContext.value }));
vi.mock('../../src/features/catalog/useCatalogPoll', () => ({ useCatalogPoll: () => {} }));
vi.mock('../../src/features/player/SwarmHlsPlayer', () => ({
  SwarmHlsPlayer: ({ onPlaying }: { onPlaying?: () => void }) =>
    createElement('video', { 'data-testid': 'player', onPlaying }),
}));

const CHAT: ChatConfig = {
  enabled: true,
  readUrl: '/chat-read',
  writeUrl: '/chat-write',
  gsocResourceId: 'd'.repeat(64),
  gsocTopic: 'gsoc-topic',
  feedOwner: '0x' + 'b'.repeat(40),
  pollIntervalMs: 500,
};

let mounted: Mounted | null = null;

function openWatchPage() {
  mounted = mount(
    createElement(
      ChatUserProvider,
      null,
      createElement(
        MemoryRouter,
        { initialEntries: [`/watch/video/${'a'.repeat(40)}/stream-one`] },
        createElement(
          Routes,
          null,
          createElement(Route, { path: '/watch/:mediatype/:owner/:topic', element: createElement(StreamWatcher) }),
        ),
      ),
    ),
  );
}

function playerStarts() {
  const video = document.querySelector('video');
  act(() => {
    video?.dispatchEvent(new Event('playing'));
  });
}

beforeEach(() => {
  FakeSwarmChat.reset();
  localStorage.clear();
});

afterEach(() => {
  mounted?.unmount();
  mounted = null;
  document.body.innerHTML = '';
  vi.useRealTimers();
});

describe('the chat on the watch page', () => {
  it('is not there at all when the config switches chat off', async () => {
    appContext.value = { ...appContext.value, chat: null };
    openWatchPage();
    playerStarts();
    await settle();
    expect(document.querySelector('.watch-layout-side')).toBeNull();
    expect(document.querySelector('.watch-layout.with-side')).toBeNull();
    expect(FakeSwarmChat.instances).toHaveLength(0);
  });

  it('keeps its place beside the player and loads with the page, before the player has started', async () => {
    appContext.value = { ...appContext.value, chat: CHAT };
    openWatchPage();
    expect(document.querySelector('.watch-layout-side')).not.toBeNull();

    await waitFor(() => FakeSwarmChat.instances[0]);
    expect(FakeSwarmChat.latest().settings.infra.chatTopic).toBe('chat-stream-one');
    expect(text()).toContain('Chat');
  });

  it('keeps the one chat it started when the player starts afterwards', async () => {
    appContext.value = { ...appContext.value, chat: CHAT };
    openWatchPage();
    await waitFor(() => FakeSwarmChat.instances[0]);

    playerStarts();
    await settle();
    expect(FakeSwarmChat.instances).toHaveLength(1);
  });
});
