import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { expect, test } from '@playwright/test';
import { parseChatMessage } from '@solarpunkltd/swarm-chat-js';

import { answerSlotNotesAsAbsent, onChatWrite, refuseOtherOrigins, serveConfig, watchAndChat } from './journey';
import {
  type ChatWriteAnswer,
  GATEWAY_URL_PATTERN,
  type Published,
  PREVIEW_ORIGIN,
  RECORDED_DIR,
  RecordingFile,
  SMOKE_MESSAGE,
  SMOKE_USER,
} from './recording';

/** A chat write's body is a chunk: an 8-byte span, then the message bytes. */
const SPAN_BYTES = 8;

const read = <T>(file: string): T => JSON.parse(readFileSync(join(RECORDED_DIR, file), 'utf8')) as T;

test('a viewer opens the list, watches a finished stream and sends a chat message', async ({ page, context }) => {
  const published = read<Published>(RecordingFile.PUBLISHED);
  const answer = read<ChatWriteAnswer>(RecordingFile.CHAT_WRITE_ANSWER);
  const writes: Buffer[] = [];

  await refuseOtherOrigins(context);
  // A request the recording does not hold is aborted, and so fails the journey, rather than reaching anything.
  await page.routeFromHAR(join(RECORDED_DIR, RecordingFile.HAR), { url: GATEWAY_URL_PATTERN, notFound: 'abort' });
  const config = read<{ chat: { feedOwner: string } }>(RecordingFile.CONFIG);
  await serveConfig(page, config);
  await answerSlotNotesAsAbsent(page, published.chat.topic, config.chat.feedOwner);
  // Every run signs a new message, which no recording can hold, so the page's write gets the node's recorded answer.
  await onChatWrite(page, async (route) => {
    writes.push(route.request().postDataBuffer() ?? Buffer.alloc(0));
    await route.fulfill({ status: answer.status, contentType: answer.contentType, body: answer.body });
  });

  await watchAndChat(page, published);

  expect(writes.length, 'the page wrote the message to the chat inbox').toBeGreaterThan(0);
  const check = parseChatMessage(new Uint8Array(writes[0].subarray(SPAN_BYTES)), {
    origins: [PREVIEW_ORIGIN],
    allowLocalHttp: true,
  });
  expect(check.ok, check.ok ? '' : `the written message is refused: ${check.reason}, ${check.detail}`).toBe(true);
  if (check.ok) {
    expect(check.message).toMatchObject({
      topic: published.chat.topic,
      text: SMOKE_MESSAGE,
      name: SMOKE_USER,
      type: 'text',
    });
  }
});
