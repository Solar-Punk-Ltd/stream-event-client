/** The chat server's counts that the security set reads: messages received, and those dropped by reason. */
export interface ServerCounts {
  received: number;
  dropped: Record<string, number>;
}

/** The counts the security set reads out of the chat server's `/health` body, or null for a body that is not one. */
export function countsOf(body: unknown): ServerCounts | null {
  const counts = (body as { counts?: { received?: unknown; dropped?: Record<string, number> } } | null)?.counts;
  if (typeof counts?.received !== 'number') return null;
  return { received: counts.received, dropped: counts.dropped ?? {} };
}

/** What a step wrote to the inbox: how many messages, and how many of them the server must drop for each reason. */
export interface ExpectedCounts {
  received: number;
  dropped: Record<string, number>;
}

/**
 * The server sends itself a heartbeat through the inbox every minute and drops a repeat or a stranger of one under these
 * reasons. A heartbeat is never counted as received, so its drops say nothing about what a step wrote.
 */
const isHeartbeatReason = (reason: string) => reason.startsWith('heartbeat-');

const rise = (before: Record<string, number>, after: Record<string, number>, reason: string) =>
  (after[reason] ?? 0) - (before[reason] ?? 0);

/**
 * What is wrong with the server's counts against what was written, one line each, none when they agree exactly: every
 * write received, each named reason risen by the number forged for it, and no other reason risen but the heartbeats'.
 */
export function countProblems(before: ServerCounts, after: ServerCounts, expected: ExpectedCounts): string[] {
  const problems: string[] = [];
  const received = after.received - before.received;
  if (received !== expected.received) {
    problems.push(`the server received ${received} of the ${expected.received} writes`);
  }
  for (const [reason, count] of Object.entries(expected.dropped)) {
    const rose = rise(before.dropped, after.dropped, reason);
    if (rose !== count) problems.push(`the server dropped ${rose} as ${reason}, not ${count}`);
  }
  for (const reason of Object.keys(after.dropped)) {
    const rose = rise(before.dropped, after.dropped, reason);
    if (!(reason in expected.dropped) && !isHeartbeatReason(reason) && rose > 0) {
      problems.push(`the server dropped ${rose} as ${reason}, which nothing forged`);
    }
  }
  return problems;
}

/** How a write of the identical bytes twice ended, either way the repeat is not published again. */
type ReplayOutcome = { outcome: string } | { problem: string };

/**
 * Reads the server's counts around two writes of the identical message. Either the server received both and dropped
 * the second as a duplicate, or Bee never handed the identical chunk over a second time and the server received one.
 * Anything else means the repeat was taken as new, or the first write never arrived.
 */
export function replayOutcome(before: ServerCounts, after: ServerCounts): ReplayOutcome {
  const received = after.received - before.received;
  const duplicate = rise(before.dropped, after.dropped, 'duplicate');
  if (received === 2 && duplicate === 1) return { outcome: 'the server dropped the repeat as a duplicate' };
  if (received === 1 && duplicate === 0) {
    return {
      outcome: 'Bee did not hand the identical chunk over a second time, so the repeat never reached the server',
    };
  }
  const why = received === 0 ? 'the first write never arrived' : 'the repeat was taken as new';
  return { problem: `the server received ${received} writes and dropped ${duplicate} as duplicate, so ${why}` };
}
