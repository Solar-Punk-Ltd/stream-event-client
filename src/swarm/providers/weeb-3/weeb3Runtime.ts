import type { DownloadProgress, ProviderState } from '../../provider';
import { loadWeeb3Package } from './weeb3Module';
import type { Weeb3Node, Weeb3Package } from './weeb3Package';

/** Where the build places the package's files, which its service worker and shared worker are served from. */
export const WEEB3_PATH = '/weeb-3/';

const WASM_URL = `${WEEB3_PATH}weeb_3_bg.wasm`;

/** The service worker's scope, so its `/weeb-3/` routes answer a page served anywhere on the site. */
const SERVICE_WORKER_SCOPE = '/';

/** weeb-3's initial connection target, `CONNECTION_BUILDUP_LIMIT` in its `src/accounting.rs` and in its project README. */
export const WEEB3_HEALTHY_PEERS = 200;

/** How often the node's peer count is read, for the status line and for when it becomes ready. */
export const WEEB3_PEER_POLL_MS = 500;

/**
 * How long a node may take to find its first peer before it counts as failed. A node usually finds one
 * within seconds, so this leaves room for a slow network and still gives up on one that refuses it.
 */
export const WEEB3_START_DEADLINE_MS = 30_000;

/** How long the 2.2 MB module may take to download, a slow connection's worth, before the start fails. */
export const WEEB3_DOWNLOAD_DEADLINE_MS = 60_000;

export interface Weeb3Status {
  readonly state: ProviderState;
  readonly peers: number;
  /** How much of the WebAssembly module has arrived, while it downloads. */
  readonly download?: DownloadProgress;
}

type Listener = (status: Weeb3Status) => void;

interface Weeb3RuntimeOptions {
  /** Injected by tests. The one loader in `weeb3Module.ts` otherwise. */
  readonly load?: () => Promise<Weeb3Package>;
  /** Whether weeb-3's service worker controls this page, which its `/weeb-3/` reads go through. */
  readonly isControlled?: () => boolean;
  /** Injected by tests. The global `fetch` otherwise. */
  readonly fetcher?: typeof fetch;
  /** The module's size in bytes. What the build recorded otherwise, and none in an unbundled test. */
  readonly wasmBytes?: number | null;
}

const STOPPED: Weeb3Status = { state: 'stopped', peers: 0 };

function pageIsControlled(): boolean {
  return typeof navigator !== 'undefined' && navigator.serviceWorker?.controller != null;
}

/**
 * The one weeb-3 node of a page, which its reads provider and its player share, because the package
 * runs one node per browser behind a shared worker. Ready once it has a peer and its service worker
 * controls the page. Whatever needs the node holds it, and the node runs while anything does: the last
 * release stops it and frees it.
 */
export class Weeb3Runtime {
  private readonly load: () => Promise<Weeb3Package>;
  private readonly isControlled: () => boolean;
  private readonly fetcher: typeof fetch;
  private readonly wasmBytes: number | null;
  private readonly listeners = new Set<Listener>();
  private current: Weeb3Status = STOPPED;
  private node: Promise<Weeb3Node> | null = null;
  private poll: ReturnType<typeof setTimeout> | null = null;
  private generation = 0;
  private holders = 0;
  private downloading: AbortController | null = null;
  private pendingStop: ReturnType<typeof setTimeout> | null = null;

  constructor(options: Weeb3RuntimeOptions = {}) {
    this.load = options.load ?? loadWeeb3Package;
    this.isControlled = options.isControlled ?? pageIsControlled;
    // Called bare by `download`, never as this object's method, which the browser's fetch would refuse.
    this.fetcher = options.fetcher ?? fetch;
    this.wasmBytes = options.wasmBytes ?? (typeof __WEEB3_WASM_BYTES__ === 'undefined' ? null : __WEEB3_WASM_BYTES__);
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

  /** Holds the node, starting it if nothing held it, and answers it once made. */
  acquire(): Promise<Weeb3Node> {
    this.holders += 1;
    this.cancelStop();
    return this.start();
  }

  /**
   * Lets go of one hold. The last one stops the node a tick later, so a holder that is replaced at once,
   * such as a part's client made again or a player shown again, keeps the node it had.
   */
  release(): void {
    if (this.holders === 0) {
      return;
    }
    this.holders -= 1;
    if (this.holders === 0) {
      this.cancelStop();
      this.pendingStop = setTimeout(() => {
        this.pendingStop = null;
        void this.stop();
      }, 0);
    }
  }

  private cancelStop(): void {
    if (this.pendingStop !== null) {
      clearTimeout(this.pendingStop);
      this.pendingStop = null;
    }
  }

  /** The node once it is ready. Rejects if it fails or is stopped first. */
  whenReady(): Promise<Weeb3Node> {
    return new Promise((resolve, reject) => {
      const check = (status: Weeb3Status) => {
        if (status.state === 'ready' && this.node) {
          unsubscribe();
          this.node.then(resolve, reject);
        } else if (status.state === 'failed' || status.state === 'stopped') {
          unsubscribe();
          reject(
            new Error(`the node in this browser ${status.state === 'failed' ? 'failed to start' : 'was stopped'}`),
          );
        }
      };
      const unsubscribe = this.subscribe(check);
      check(this.current);
    });
  }

  async stop(): Promise<void> {
    const node = this.node;
    this.downloading?.abort();
    this.downloading = null;
    this.generation += 1;
    this.node = null;
    this.clearPoll();
    this.set(STOPPED);
    (await node?.catch(() => null))?.free();
  }

  private async started(generation: number): Promise<Weeb3Node> {
    this.clearPoll();
    try {
      const [weeb3, wasm] = await Promise.all([this.load(), this.download(generation)]);
      if (generation === this.generation) {
        this.set({ state: 'starting', peers: 0 });
      }
      await weeb3.default({ module_or_path: wasm });
      if (generation !== this.generation) {
        throw new Error('the node in this browser was stopped while it started');
      }
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

  /**
   * The WebAssembly module, fetched here rather than by the package so a viewer can be shown how much
   * of its 2 MB has arrived.
   */
  private async download(generation: number): Promise<Uint8Array<ArrayBuffer>> {
    const progress = (receivedBytes: number, totalBytes: number | null) => {
      if (generation === this.generation) {
        this.set({ state: 'starting', peers: 0, download: { receivedBytes, totalBytes } });
      }
    };
    progress(0, null);
    const controller = new AbortController();
    this.downloading = controller;
    const deadline = setTimeout(() => controller.abort(), WEEB3_DOWNLOAD_DEADLINE_MS);
    try {
      return await this.read(controller.signal, progress);
    } finally {
      clearTimeout(deadline);
      if (this.downloading === controller) {
        this.downloading = null;
      }
    }
  }

  private async read(
    signal: AbortSignal,
    progress: (receivedBytes: number, totalBytes: number | null) => void,
  ): Promise<Uint8Array<ArrayBuffer>> {
    const fetcher = this.fetcher;
    const response = await fetcher(WASM_URL, { signal });
    if (!response.ok) {
      throw new Error(`the node's module could not be downloaded: the server answered ${response.status}`);
    }
    // The build's own count wins, since a server that compresses the module names no length or the compressed one.
    const length = Number(response.headers.get('content-length'));
    const totalBytes = this.wasmBytes ?? (Number.isFinite(length) && length > 0 ? length : null);
    progress(0, totalBytes);
    if (!response.body) {
      const whole = new Uint8Array(await response.arrayBuffer());
      progress(whole.length, totalBytes);
      return whole;
    }
    const parts: Uint8Array[] = [];
    let receivedBytes = 0;
    const reader = response.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      parts.push(value);
      receivedBytes += value.length;
      progress(receivedBytes, totalBytes);
    }
    const whole = new Uint8Array(receivedBytes);
    let at = 0;
    for (const part of parts) {
      whole.set(part, at);
      at += part.length;
    }
    return whole;
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
        this.node = null;
        node.free();
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
    const { state, peers, download } = this.current;
    if (
      status.state === state &&
      status.peers === peers &&
      status.download?.receivedBytes === download?.receivedBytes &&
      status.download?.totalBytes === download?.totalBytes
    ) {
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
