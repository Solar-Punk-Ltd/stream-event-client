import type { HlsStart, Weeb3Node, Weeb3Package } from '../../src/swarm/providers/weeb-3/weeb3Package';

/** One node the fake package made, with what the page asked of it. */
interface FakeWeeb3Node extends Weeb3Node {
  readonly constructedWith: readonly unknown[];
  started: number;
  peers: number;
  freed: boolean;
  readonly attached: { media: HTMLMediaElement; owner: string; topic: string; start: HlsStart }[];
}

interface FakeWeeb3Options {
  /** The WebAssembly module fails to load, as the stand-in's does. */
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

/** A stand-in for the package that records what the page asked of it and answers as the test sets. */
export function fakeWeeb3Package(options: FakeWeeb3Options = {}): FakeWeeb3 {
  const nodes: FakeWeeb3Node[] = [];
  const initInputs: unknown[] = [];
  let loads = 0;

  class FakeNode implements FakeWeeb3Node {
    readonly constructedWith: readonly unknown[];
    started = 0;
    peers = 0;
    freed = false;
    readonly attached: FakeWeeb3Node['attached'] = [];

    constructor(...args: unknown[]) {
      this.constructedWith = args;
      nodes.push(this);
    }

    start(): void {
      this.started += 1;
    }

    async connectionCount(): Promise<number> {
      return this.peers;
    }

    async attachStream(media: HTMLMediaElement, owner: string, topic: string, start: HlsStart): Promise<void> {
      this.attached.push({ media, owner, topic, start });
      await options.onAttach?.(media);
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
