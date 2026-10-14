import { join } from 'node:path';

/**
 * What the recorder and the smoke test agree on. The recorder writes a recording into a folder, the smoke test replays
 * the one committed under `e2e/recorded/`, and both run the built app on the same origin, because a HAR entry is
 * matched by its whole URL.
 */
export const PREVIEW_PORT = 4173;
export const PREVIEW_ORIGIN = `http://127.0.0.1:${PREVIEW_PORT}`;

/** Every Bee request the page makes goes through this prefix, which `vite preview` forwards to a node. */
export const GATEWAY_PATH = '/bee';
export const GATEWAY_URL_PATTERN = `${PREVIEW_ORIGIN}${GATEWAY_PATH}/**`;

export const RECORDED_DIR = join(import.meta.dirname, 'recorded');

export const RecordingFile = {
  /** The page's Bee traffic, with each body in a file of its own beside it. */
  HAR: 'viewer.har',
  /** The config.json the page is served while recording and on replay. */
  CONFIG: 'config.json',
  /** What was published, so the smoke test names the stream and the messages it expects. */
  PUBLISHED: 'published.json',
  /** A real node's answer to a chat write, which the smoke test hands the page's own write. */
  CHAT_WRITE_ANSWER: 'chat-write-answer.json',
} as const;

/** The stream and the chat the recorder publishes and the smoke test looks for. */
export interface Published {
  stream: { owner: string; topic: string; title: string; segments: number };
  chat: {
    topic: string;
    texts: string[];
    names: string[];
    /** The one message a Swarm ID account vouched for, and that account. Every other message is a guest's. */
    swarmId: { text: string; account: string };
    /** The one message sent with its sender's own stamp. */
    ownStamp: { text: string };
  };
  bee: { version: string };
}

export interface ChatWriteAnswer {
  status: number;
  contentType: string;
  body: string;
}

/**
 * The shared key every viewer signs chat inbox writes with. It is public configuration by design, and this one exists
 * only on the recording's throwaway chain, so it is written here in the open.
 */
export const RECORDING_INBOX_KEY = '11'.repeat(32);
export const RECORDING_INBOX_TOPIC = 'stream-event-client-recording';

/** The name the smoke test logs in with and the message it sends, the same while recording and on replay. */
export const SMOKE_USER = 'smoke';
export const SMOKE_MESSAGE = 'hello from the smoke test';

/** The viewer's settings for a recording. The chat reads and writes through the same prefix as the video. */
export function recordingConfig(
  catalog: { owner: string; topic: string },
  chat: { gsocResourceId: string; gsocTopic: string; feedOwner: string },
) {
  return {
    gatewayUrl: GATEWAY_PATH,
    catalog,
    chat: {
      enabled: true,
      readUrl: `${PREVIEW_ORIGIN}${GATEWAY_PATH}`,
      writeUrl: `${PREVIEW_ORIGIN}${GATEWAY_PATH}`,
      ...chat,
      pollIntervalMs: 1000,
    },
  };
}
