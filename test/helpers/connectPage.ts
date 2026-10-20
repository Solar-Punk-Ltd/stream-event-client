import { createElement, type ReactNode, StrictMode } from 'react';

import { AppContextProvider, useAppContext } from '../../src/app/AppProvider';
import { ThemeChoiceProvider } from '../../src/app/ThemeChoiceProvider';
import { type RuntimeConfig, swarmIdUrl } from '../../src/config/runtimeConfig';
import { AppChatUserProvider } from '../../src/app/AppChatUserProvider';
import { ChatStampProvider, useChatStamp } from '../../src/features/chat/stamp/ChatStamp';
import { useChatUser } from '../../src/features/chat/User';
import { Connect } from '../../src/features/connect/Connect';
import { ConnectProvider, useConnect } from '../../src/features/connect/ConnectContext';

import { mount, type Mounted } from './dom';
import type { FakeSwarmId } from './fakeSwarmId';
import { minimalConfig } from './themeChoice';

/** A chat that is on, at addresses no test reaches. */
export const CHAT = {
  enabled: true,
  readUrl: 'https://chat-read.example.com',
  writeUrl: 'https://chat-write.example.com',
  gsocResourceId: 'd'.repeat(64),
  gsocTopic: 'the-inbox',
  feedOwner: '0x' + 'b'.repeat(40),
  pollIntervalMs: 500,
};

/** A deployment with the chat on and two gateways offered, the event's the default. */
export function chatConfig(extra: Record<string, unknown> = {}): RuntimeConfig {
  return minimalConfig({
    gatewayUrl: undefined,
    providers: {
      gateways: [
        { id: 'event', kind: 'bee-http', label: 'Event gateway', url: 'https://event.example.com' },
        { id: 'backup', kind: 'bee-http', label: 'Backup gateway', url: 'https://backup.example.com' },
      ],
      default: 'event',
    },
    chat: CHAT,
    ...extra,
  });
}

interface Seen {
  app: ReturnType<typeof useAppContext> | null;
  chatUser: ReturnType<typeof useChatUser> | null;
  connect: ReturnType<typeof useConnect> | null;
  chatStamp: ReturnType<typeof useChatStamp> | null;
}

/** What the page's providers hold as the test runs, read after each step. */
export const seen: Seen = { app: null, chatUser: null, connect: null, chatStamp: null };

function Probe() {
  seen.app = useAppContext();
  seen.chatUser = useChatUser();
  seen.connect = useConnect();
  seen.chatStamp = useChatStamp();
  return null;
}

interface ConnectPageOptions {
  readonly config?: RuntimeConfig;
  readonly swarmId?: FakeSwarmId | null;
  readonly children?: readonly ReactNode[];
  /** Under React's StrictMode, as the app renders, which mounts every effect twice in development. */
  readonly strict?: boolean;
}

/** The config's own Swarm ID site where it names one, through the app's rule, and a test site where it names none. */
function offeredSwarmId(config: RuntimeConfig): string | null {
  return config.swarmId ? swarmIdUrl(config) : 'https://id.example.com';
}

/** The page's header as the app builds it: Connect, in every provider the app has. */
export function connectPage({
  config = chatConfig(),
  swarmId = null,
  children = [],
  strict = false,
}: ConnectPageOptions = {}): Mounted {
  const page = createElement(
    AppContextProvider,
    { config },
    createElement(
      ThemeChoiceProvider,
      { config },
      createElement(
        AppChatUserProvider,
        swarmId
          ? { swarmIdUrl: offeredSwarmId(config), appName: 'Devcon streams', loadSwarmIdClient: swarmId.load }
          : {},
        createElement(
          ConnectProvider,
          null,
          createElement(
            ChatStampProvider,
            null,
            createElement(Connect, { key: 'connect' }),
            createElement(Probe, { key: 'probe' }),
            ...children,
          ),
        ),
      ),
    ),
  );
  return mount(strict ? createElement(StrictMode, null, page) : page);
}
