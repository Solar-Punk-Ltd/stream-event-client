import type { SwarmProvider } from './provider';
import type { ProviderKindName } from './providerKinds';
import { BeeHttpProvider } from './providers/bee-http/beeHttpProvider';
import { Weeb3Provider } from './providers/weeb-3/weeb3Provider';
import { sharedWeeb3Runtime } from './providers/weeb-3/weeb3Runtime';
import type { GatewaySetting } from './settings';

/** What every provider is made with, apart from its own settings. */
export interface ProviderEnvironment {
  /** Injected by tests. The global `fetch` otherwise. */
  readonly fetcher?: typeof fetch;
  /** The page's own origin. Read from the page when absent. */
  readonly pageOrigin?: string;
}

/** Where a player starts a stream: at its newest entry, or at the first it can rebuild. */
type PlaybackStart = 'live' | 'beginning';

/** A player a kind of provider brings with it, which plays into a video element the page owns. */
interface OwnPlayer {
  attach(video: HTMLVideoElement, owner: string, topic: string, from: PlaybackStart): Promise<void>;
}

/** One kind of provider: what a viewer is shown it as, and how one is made from a gateway's settings. */
export interface ProviderKind {
  readonly label: string;
  create(gateway: GatewaySetting, environment: ProviderEnvironment): SwarmProvider;
  /**
   * The player this kind plays video with, loaded when a viewer watches through it, or null where the
   * app's own player reads through the provider.
   */
  readonly ownPlayer: (() => Promise<OwnPlayer>) | null;
}

/** weeb-3's own player on the page's one node, which it starts if nothing has yet. */
async function weeb3Player(): Promise<OwnPlayer> {
  const node = await sharedWeeb3Runtime().start();
  return { attach: (video, owner, topic, from) => node.attachStream(video, owner, topic, from) };
}

/** Every kind this build carries. A kind added here is offered wherever a config lists it. */
export const PROVIDER_REGISTRY: Readonly<Record<ProviderKindName, ProviderKind>> = {
  'bee-http': {
    label: 'A Bee node over HTTP',
    create: (gateway, environment) => new BeeHttpProvider({ baseUrl: gateway.url, ...environment }),
    ownPlayer: null,
  },
  'weeb-3': {
    label: 'A Swarm node in this browser',
    create: (_gateway, environment) => new Weeb3Provider({ runtime: sharedWeeb3Runtime(), ...environment }),
    ownPlayer: weeb3Player,
  },
};
