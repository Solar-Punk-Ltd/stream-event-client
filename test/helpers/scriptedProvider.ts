import type { SwarmAnswer } from '../../src/swarm/answers';
import type { ProviderCapabilities, SwarmProvider, UrlUse } from '../../src/swarm/provider';

export type ScriptedRead = 'feed-head' | 'feed-entry' | 'chunk' | 'bytes';

/** A provider whose every read answers what the test says it does now, and which logs what it was asked. */
export class ScriptedProvider implements SwarmProvider {
  capabilities: ProviderCapabilities = {
    feedHead: true,
    feedEntry: true,
    chunk: true,
    bytes: true,
    urls: true,
    inTab: false,
  };

  /** What every read answers until the test changes it. */
  answer: SwarmAnswer = { kind: 'content', bytes: new Uint8Array([1]), feedIndex: null, serverTimeMs: null };

  readonly asked: ScriptedRead[] = [];
  started = 0;
  stopped = 0;

  constructor(readonly name: string) {}

  async readFeedHead(): Promise<SwarmAnswer> {
    return this.ask('feed-head');
  }

  async readFeedEntry(): Promise<SwarmAnswer> {
    return this.ask('feed-entry');
  }

  async readChunk(): Promise<SwarmAnswer> {
    return this.ask('chunk');
  }

  async readBytes(): Promise<SwarmAnswer> {
    return this.ask('bytes');
  }

  urlFor(reference: string, use: UrlUse): string | null {
    return this.capabilities.urls ? `${this.name}:${use}:${reference}` : null;
  }

  status() {
    return { state: 'ready' as const };
  }

  async probe() {
    return { kind: 'ok' as const, elapsedMs: 0 };
  }

  async start(): Promise<void> {
    this.started += 1;
  }

  async stop(): Promise<void> {
    this.stopped += 1;
  }

  private ask(read: ScriptedRead): SwarmAnswer {
    this.asked.push(read);
    return this.answer;
  }
}

export const content = (serverTimeMs: number | null = null): SwarmAnswer => ({
  kind: 'content',
  bytes: new Uint8Array([7]),
  feedIndex: null,
  serverTimeMs,
});

export const fault: SwarmAnswer = { kind: 'unavailable', cause: { kind: 'network', error: new TypeError('Failed') } };

export const notFound: SwarmAnswer = { kind: 'not-found', serverTimeMs: null };
