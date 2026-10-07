import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { ChatSettings } from '@solarpunkltd/swarm-chat-js';

import { chatSettings } from '../../src/features/chat/chatSettings';
import { parseRuntimeConfig } from '../../src/config/runtimeConfig';

/**
 * A Bee node that answers from the recording the browser smoke test replays, `e2e/recorded/viewer.har`,
 * matched by the whole URL as the replay matches it. So a provider that passes against this asks the
 * exact URLs the recorded page asked, and nothing here reaches a network.
 */

const RECORDED_DIR = join(dirname(dirname(dirname(fileURLToPath(import.meta.url)))), 'e2e', 'recorded');

/** The gateway base the recording was made through, the preview server's `/bee` prefix. */
export const RECORDED_GATEWAY = 'http://127.0.0.1:4173/bee';

interface HarEntry {
  request: { method: string; url: string };
  response: {
    status: number;
    headers: { name: string; value: string }[];
    content: { _file?: string; text?: string };
  };
}

export interface RecordedAnswer {
  readonly status: number;
  readonly headers: Headers;
  readonly body: Uint8Array;
}

/** Every GET the recording answered, by URL. A request the page abandoned has status -1 and is left out. */
function recordedAnswers(): Map<string, RecordedAnswer> {
  const har = JSON.parse(readFileSync(join(RECORDED_DIR, 'viewer.har'), 'utf8')) as { log: { entries: HarEntry[] } };
  const answers = new Map<string, RecordedAnswer>();
  for (const { request, response } of har.log.entries) {
    if (request.method !== 'GET' || response.status <= 0 || answers.has(request.url)) {
      continue;
    }
    const { _file, text } = response.content;
    answers.set(request.url, {
      status: response.status,
      headers: new Headers(response.headers.map(({ name, value }) => [name, value])),
      body: new Uint8Array(_file ? readFileSync(join(RECORDED_DIR, _file)) : Buffer.from(text ?? '')),
    });
  }
  return answers;
}

const RECORDED = recordedAnswers();

const readRecordedJson = <T>(file: string): T => JSON.parse(readFileSync(join(RECORDED_DIR, file), 'utf8')) as T;

/** The stream list feed the recording read, as its config names it. */
export function recordedCatalog(): { owner: string; topic: string } {
  return readRecordedJson<{ catalog: { owner: string; topic: string } }>('config.json').catalog;
}

/** The finished stream the recording published, whose first entry it read by index. */
export function recordedStream(): { owner: string; topic: string } {
  return readRecordedJson<{ stream: { owner: string; topic: string } }>('published.json').stream;
}

/** The chat's settings for the recorded stream, as the watch page builds them from the recorded config. */
export function recordedChatSettings(): ChatSettings {
  const parsed = parseRuntimeConfig(readRecordedJson<unknown>('config.json'));
  if (!parsed.ok || !parsed.config.chat?.enabled) {
    throw new Error('the recorded config has no chat');
  }
  return chatSettings(parsed.config.chat, recordedStream().topic, null);
}

/** Every URL the recording answered a GET for. */
export function recordedUrls(): string[] {
  return [...RECORDED.keys()];
}

/** Bee path kinds the recording holds a served read of. */
export type RecordedPathKind = 'feeds' | 'soc' | 'chunks' | 'bytes';

/**
 * The first path of one kind the recording served, relative to {@link RECORDED_GATEWAY}, such as
 * `chunks/<address>`. Read from the recording rather than written into a test, so a test names what
 * was recorded without repeating its addresses.
 */
export function firstRecordedPath(kind: RecordedPathKind): string {
  for (const [url, answer] of RECORDED) {
    const path = url.slice(RECORDED_GATEWAY.length + 1);
    if (answer.status === 200 && path.startsWith(`${kind}/`)) {
      return path;
    }
  }
  throw new Error(`the recording holds no served ${kind} read`);
}

/** The recorded body for one URL, which a test compares a provider's content against. */
export function recordedBody(url: string): Uint8Array {
  const answer = RECORDED.get(url);
  if (!answer) {
    throw new Error(`the recording holds no answer for ${url}`);
  }
  return answer.body;
}

/** Bee's own answer for something it does not hold, the shape the ladder journeys' fake answers too. */
function notFound(): Response {
  return new Response(JSON.stringify({ code: 404, message: 'Not Found' }), {
    status: 404,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

function abortError(): Error {
  const error = new Error('The operation was aborted');
  error.name = 'AbortError';
  return error;
}

/** Every URL a fake was asked, in order. */
export interface AskedLog {
  readonly urls: string[];
}

/** Answers what the recording holds and 404 for anything else, as a node without that content does. */
export function recordedFetch(log: AskedLog = { urls: [] }): typeof fetch {
  return (async (input: RequestInfo | URL) => {
    const url = String(input);
    log.urls.push(url);
    const answer = RECORDED.get(url);
    if (!answer) {
      return notFound();
    }
    return new Response(answer.body.slice(), { status: answer.status, headers: answer.headers });
  }) as typeof fetch;
}

/** Accepts every request and answers none, until the request's signal gives up on it. */
export function silentFetch(log: AskedLog = { urls: [] }): typeof fetch {
  return ((input: RequestInfo | URL, init?: RequestInit) => {
    log.urls.push(String(input));
    return new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(abortError()));
    });
  }) as typeof fetch;
}

/** Fails every request the way a browser reports a closed port, a DNS miss or a CORS refusal. */
export function faultyFetch(log: AskedLog = { urls: [] }): typeof fetch {
  return (async (input: RequestInfo | URL) => {
    log.urls.push(String(input));
    throw new TypeError('Failed to fetch');
  }) as typeof fetch;
}

/** Answers every request with a status and the headers given. */
export function answeringFetch(status: number, headers: Record<string, string> = {}, body = ''): typeof fetch {
  return (async () => new Response(body, { status, headers })) as typeof fetch;
}
