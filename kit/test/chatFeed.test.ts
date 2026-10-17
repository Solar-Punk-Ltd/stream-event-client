import { MessageVia } from '@solarpunkltd/swarm-chat-js';
import { describe, expect, it } from 'vitest';

import { chatFeedProblems } from '../src/chatFeed.ts';

const RUN = 'run-7f3a';
const entry = (text: string, via: MessageVia, account: string | null = 'aa', addr = 'cc'.repeat(20)) => ({
  index: 0,
  ok: true as const,
  text,
  via,
  account,
  addr,
});

describe('chatFeedProblems', () => {
  it('passes when the feed holds every message the run sent, each paid as sent', () => {
    const sent = [{ actor: 'alice', text: `one ${RUN}`, via: MessageVia.GATEWAY }];
    expect(chatFeedProblems([entry(`one ${RUN}`, MessageVia.GATEWAY)], sent, RUN)).toEqual([]);
  });

  it('refuses a run that sent nothing, whose feed proves nothing', () => {
    expect(chatFeedProblems([entry(`one ${RUN}`, MessageVia.GATEWAY)], [], RUN)).toEqual([
      'the run sent no message, so the feed proves nothing',
    ]);
  });

  it('refuses a sent text that does not carry the run id, which an earlier run could have left', () => {
    const sent = [{ actor: 'alice', text: 'hello', via: MessageVia.GATEWAY }];
    expect(chatFeedProblems([entry('hello', MessageVia.GATEWAY)], sent, RUN)).toEqual([
      '"hello" does not carry the run id, so an earlier run could have left it',
    ]);
  });

  it('names a message missing, one with no binding, and one paid another way', () => {
    const sent = [
      { actor: 'alice', text: `a ${RUN}`, via: MessageVia.GATEWAY },
      { actor: 'alice', text: `b ${RUN}`, via: MessageVia.GATEWAY },
      { actor: 'alice', text: `c ${RUN}`, via: MessageVia.OWN_STAMP },
    ];
    const entries = [entry(`b ${RUN}`, MessageVia.GATEWAY, null), entry(`c ${RUN}`, MessageVia.GATEWAY)];
    expect(chatFeedProblems(entries, sent, RUN)).toEqual([
      `the chat feed does not hold "a ${RUN}"`,
      `"b ${RUN}" carries no Swarm ID binding`,
      `"c ${RUN}" says it was paid ${MessageVia.GATEWAY}, not ${MessageVia.OWN_STAMP}`,
    ]);
  });
});
