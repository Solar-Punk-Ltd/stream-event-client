/**
 * Closing an actor's browser context can wait for good: Playwright writes the context's network recording on close and
 * waits for every request still open, and a live viewer keeps a player asking for its stream. So a close has a deadline,
 * and the requests still open when it began are written down, which says what it waited on.
 */

/** How long an actor's context may take to close before the run goes on without it. */
export const CLOSE_DEADLINE_MS = 60_000;
/** The file in an actor's evidence folder that lists the requests still open when its close began. */
export const OPEN_AT_CLOSE_FILE = 'open-at-close.json';

interface RequestLike {
  method(): string;
  url(): string;
}

interface RequestEvents {
  on(event: 'request' | 'requestfinished' | 'requestfailed', listener: (request: RequestLike) => void): unknown;
}

/** The requests a context has started that have neither finished nor failed. */
export class OpenRequests {
  private readonly open = new Set<RequestLike>();

  static of(context: RequestEvents): OpenRequests {
    const tracker = new OpenRequests();
    context.on('request', (request) => tracker.open.add(request));
    context.on('requestfinished', (request) => tracker.open.delete(request));
    context.on('requestfailed', (request) => tracker.open.delete(request));
    return tracker;
  }

  list(): string[] {
    return [...this.open].map((request) => `${request.method()} ${request.url()}`);
  }
}

/** Runs a close and says whether it ended inside the deadline. A close that threw has ended. */
export async function closeWithin(close: () => Promise<void>, deadlineMs: number): Promise<'closed' | 'timed out'> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<'timed out'>((resolve) => {
    timer = setTimeout(() => resolve('timed out'), deadlineMs);
  });
  const closed = close().then(
    () => 'closed' as const,
    () => 'closed' as const,
  );
  try {
    return await Promise.race([closed, deadline]);
  } finally {
    clearTimeout(timer);
  }
}
