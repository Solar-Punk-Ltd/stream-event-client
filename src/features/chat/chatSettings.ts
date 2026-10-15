import { type ChatSettings, MessageVia } from '@solarpunkltd/swarm-chat-js';

import type { ChatConfig } from '@/config/runtimeConfig';

import type { Session } from './auth/login';
import { type ChatSending, GATEWAY_SENDING } from './stamp/chatSending';

/**
 * The chat library needs a key even to read, so a viewer with no name reads with this one. It signs
 * nothing: the panel asks for a name before anything is sent.
 */
export const READ_ONLY_PRIVATE_KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

/** How long the first read of a chat, its history snapshot and the viewer's own feed, may take. */
const FEED_READ_TIMEOUT_MS = 12_500;
const GSOC_WRITE_TIMEOUT_MS = 5_000;
const SOC_READ_TIMEOUT_MS = 5_000;

/**
 * One chat per stream. The topic and the owner follow the aggregator's conventions: the stream's chat
 * feed is `chat-<stream topic>`, written by the chat feed owner. The chat is read through one endpoint and
 * written through another. While the event pays, the write endpoint stamps what is written through it. On the
 * viewer's own stamp, Swarm ID stamps each message and it goes to their own Bee node or through Weeb3. Either way
 * no stamp is passed, and every message says in its `via` who paid. On the viewer's own stamp every message is signed
 * once saying it keeps a copy in their own feed, and the write stores that copy from the same bytes.
 */
export function chatSettings(
  config: ChatConfig,
  streamTopic: string,
  session: Session | null,
  sending: ChatSending = GATEWAY_SENDING,
): ChatSettings {
  return {
    user: {
      privateKey: session?.privateKey ?? READ_ONLY_PRIVATE_KEY,
      nickname: session?.username ?? '',
      ...(session?.binding ? { binding: session.binding } : {}),
      ...(session?.walletLink ? { walletLink: session.walletLink } : {}),
    },
    infra: {
      beeUrl: config.readUrl,
      ...(sending.via === MessageVia.GATEWAY
        ? { writeUrl: config.writeUrl }
        : sending.url === null
          ? {}
          : { writeUrl: sending.url }),
      via: sending.via,
      ...(sending.via === MessageVia.OWN_STAMP ? { own: true } : {}),
      gsocResourceId: config.gsocResourceId,
      gsocTopic: config.gsocTopic,
      chatTopic: `chat-${streamTopic}`,
      chatAddress: config.feedOwner,
      pollingInterval: config.pollIntervalMs,
      feedReadTimeout: FEED_READ_TIMEOUT_MS,
      gsocWriteTimeout: GSOC_WRITE_TIMEOUT_MS,
      socReadTimeout: SOC_READ_TIMEOUT_MS,
    },
  };
}
