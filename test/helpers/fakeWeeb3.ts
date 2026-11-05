import { WEEB3_HOST_WORKER_URL } from '../../src/swarm/providers/weeb-3/weeb3HostWorker';
import type {
  HlsStart,
  StreamQuality,
  Weeb3Node,
  Weeb3Package,
  Weeb3StartOptions,
} from '../../src/swarm/providers/weeb-3/weeb3Package';

/** One node the fake package made, with what the page asked of it. */
interface FakeWeeb3Node extends Weeb3Node {
  readonly constructedWith: readonly unknown[];
  started: number;
  /** What each `start` was given, `undefined` for a bare call. */
  readonly startedWith: (Weeb3StartOptions | undefined)[];
  peers: number;
  freed: boolean;
  /** What `streamQuality` answers, and what `setStreamQuality` asked for. */
  quality: StreamQuality;
  readonly held: number[];
  readonly attached: { media: HTMLMediaElement; owner: string; topic: string; start: HlsStart }[];
  readonly pushed: { data: Uint8Array; soc: boolean; chunkAddress: Uint8Array; stamp: Uint8Array }[];
}

interface FakeWeeb3Options {
  /** The WebAssembly module fails to load. */
  readonly initFails?: boolean;
  /** What `attachStream` does once called, such as start playing the media element. */
  readonly onAttach?: (media: HTMLMediaElement) => Promise<void> | void;
}

interface FakeWeeb3 {
  readonly load: () => Promise<Weeb3Package>;
  readonly nodes: FakeWeeb3Node[];
  readonly initInputs: unknown[];
  readonly loads: number;
}

/** A fake of the package that records what the page asked of it and answers as the test sets. */
export function fakeWeeb3Package(options: FakeWeeb3Options = {}): FakeWeeb3 {
  const nodes: FakeWeeb3Node[] = [];
  const initInputs: unknown[] = [];
  let loads = 0;

  class FakeNode implements FakeWeeb3Node {
    readonly constructedWith: readonly unknown[];
    started = 0;
    readonly startedWith: (Weeb3StartOptions | undefined)[] = [];
    peers = 0;
    freed = false;
    quality: StreamQuality = { levels: [], selectedLevel: -1, currentLevel: -1 };
    readonly held: number[] = [];
    readonly attached: FakeWeeb3Node['attached'] = [];
    readonly pushed: FakeWeeb3Node['pushed'] = [];

    constructor(...args: unknown[]) {
      this.constructedWith = args;
      nodes.push(this);
    }

    start(options?: Weeb3StartOptions): void {
      this.started += 1;
      this.startedWith.push(options);
    }

    async connectionCount(): Promise<number> {
      return this.peers;
    }

    async attachStream(media: HTMLMediaElement, owner: string, topic: string, start: HlsStart): Promise<void> {
      this.attached.push({ media, owner, topic, start });
      await options.onAttach?.(media);
    }

    streamQuality(): StreamQuality {
      return this.quality;
    }

    setStreamQuality(_media: HTMLMediaElement, level: number): void {
      this.held.push(level);
    }

    async postPushChunk(data: Uint8Array, soc: boolean, chunkAddress: Uint8Array, stamp: Uint8Array): Promise<string> {
      this.pushed.push({ data, soc, chunkAddress, stamp });
      return 'Upload result: success';
    }

    free(): void {
      this.freed = true;
    }
  }

  const module: Weeb3Package = {
    default: async (input) => {
      initInputs.push(input);
      if (options.initFails) {
        throw new Error('the fake package does not load');
      }
    },
    Weeb3No103: FakeNode,
  };

  return {
    load: async () => {
      loads += 1;
      return module;
    },
    nodes,
    initInputs,
    get loads() {
      return loads;
    },
  };
}

/** `navigator.serviceWorker` once weeb-3's root worker controls the page, so the node can be ready. */
export function hostWorkerInControl(): Pick<ServiceWorkerContainer, 'controller'> {
  return { controller: { scriptURL: new URL(WEEB3_HOST_WORKER_URL, location.origin).href } as ServiceWorker };
}
