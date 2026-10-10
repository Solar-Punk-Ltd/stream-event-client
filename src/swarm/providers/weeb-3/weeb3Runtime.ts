import type { ProviderState } from '../../provider';
import { loadWeeb3Package } from './weeb3Module';
import type { Weeb3Node, Weeb3Package } from './weeb3Package';

/** Where the build places the package's files, which its service worker and shared worker are served from. */
export const WEEB3_PATH = '/weeb-3/';

const WASM_URL = `${WEEB3_PATH}weeb_3_bg.wasm`;

/** The service worker's scope, so its `/weeb-3/` routes answer a page served anywhere on the site. */
const SERVICE_WORKER_SCOPE = '/';

/** How often the node's peer count is read, for the status line and for when it becomes ready. */
export const WEEB3_PEER_POLL_MS = 500;

/**
 * How long a node may take to find a peer before it counts as failed. A spike in headless Chrome found
 * its first peer in about 4 s, so this is several times that and short enough to give up on a network
 * that refuses it.
 */
export const WEEB3_START_DEADLINE_MS = 30_000;

export interface Weeb3Status {
  readonly state: ProviderState;
  readonly peers: number;
}

type Listener = (status: Weeb3Status) => void;

interface Weeb3RuntimeOptions {
  /** Injected by tests. The one loader in `weeb3Module.ts` otherwise. */
  readonly load?: () => Promise<Weeb3Package>;
  /** Whether weeb-3's service worker controls this page, which its `/weeb-3/` reads go through. */
  readonly isControlled?: () => boolean;
}

const STOPPED: Weeb3Status = { state: 'stopped', peers: 0 };

function pageIsControlled(): boolean {
  return typeof navigator !== 'undefined' && navigator.serviceWorker?.controller != null;
}

/**
 * The one weeb-3 node of a page, which its reads provider and its player share, because the package
 * runs one node per browser behind a shared worker. Ready once it has a peer and its service worker
 * controls the page.
 */
export class Weeb3Runtime {
  private readonly load: () => Promise<Weeb3Package>;
  private readonly isControlled: () => boolean;
  private readonly listeners = new Set<Listener>();
  private current: Weeb3Status = STOPPED;
  private node: Promise<Weeb3Node> | null = null;
  private poll: ReturnType<typeof setTimeout> | null = null;
  private generation = 0;

  constructor(options: Weeb3RuntimeOptions = {}) {
    this.load = options.load ?? loadWeeb3Package;
    this.isControlled = options.isControlled ?? pageIsControlled;
  }

  status(): Weeb3Status {
    return this.current;
  }

  /** Told every change of {@link status}. Answers the way to stop being told. */
  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /**
   * Starts the page's node if it is not running, and answers it once made. It is not ready yet: that
   * is what {@link status} says. A node that failed is started again.
   */
  start(): Promise<Weeb3Node> {
    if (this.node === null || this.current.state === 'failed') {
      this.node?.then(
        (old) => old.free(),
        () => undefined,
      );
      this.node = this.started(++this.generation);
    }
    return this.node;
  }

  async stop(): Promise<void> {
    const node = this.node;
    this.generation += 1;
    this.node = null;
    this.clearPoll();
    this.set(STOPPED);
    (await node?.catch(() => null))?.free();
  }

  private async started(generation: number): Promise<Weeb3Node> {
    this.clearPoll();
    this.set({ state: 'starting', peers: 0 });
    try {
      const weeb3 = await this.load();
      await weeb3.default({ module_or_path: WASM_URL });
      const node = new weeb3.Weeb3No103(undefined, SERVICE_WORKER_SCOPE);
      node.start();
      this.watchPeers(node, generation, Date.now() + WEEB3_START_DEADLINE_MS);
      return node;
    } catch (error) {
      if (generation === this.generation) {
        this.set({ state: 'failed', peers: 0 });
      }
      throw error;
    }
  }

  private watchPeers(node: Weeb3Node, generation: number, deadlineMs: number): void {
    this.poll = setTimeout(async () => {
      let peers: number;
      try {
        peers = await node.connectionCount();
      } catch {
        peers = 0;
      }
      if (generation !== this.generation) {
        return;
      }
      const ready = this.current.state === 'ready' || (peers > 0 && this.isControlled());
      if (!ready && Date.now() >= deadlineMs) {
        this.set({ state: 'failed', peers });
        return;
      }
      this.set({ state: ready ? 'ready' : 'starting', peers });
      this.watchPeers(node, generation, deadlineMs);
    }, WEEB3_PEER_POLL_MS);
  }

  private clearPoll(): void {
    if (this.poll !== null) {
      clearTimeout(this.poll);
      this.poll = null;
    }
  }

  private set(status: Weeb3Status): void {
    if (status.state === this.current.state && status.peers === this.current.peers) {
      return;
    }
    this.current = status;
    for (const listener of this.listeners) {
      listener(status);
    }
  }
}

let shared: Weeb3Runtime | null = null;

/** The page's one runtime, made the first time anything asks for it. */
export function sharedWeeb3Runtime(): Weeb3Runtime {
  shared ??= new Weeb3Runtime();
  return shared;
}
