import type { SwarmProvider } from './provider';
import type { ProviderKindName } from './providerKinds';
import { BeeHttpProvider } from './providers/bee-http/beeHttpProvider';
import { FreedomProvider } from './providers/freedom/freedomProvider';
import { pageFreedomSwarm } from './providers/freedom/freedomSwarm';
import { Weeb3Provider } from './providers/weeb-3/weeb3Provider';
import { sharedWeeb3Runtime } from './providers/weeb-3/weeb3Runtime';
import type { GatewaySetting } from './settings';

/** What every provider is made with, apart from its own settings. */
export interface ProviderEnvironment {
  /** Injected by tests. The global `fetch` otherwise. */
  readonly fetcher?: typeof fetch;
  /** The page's own origin. Read from the page when absent. */
  readonly pageOrigin?: string;
  /**
   * The deployment's default gateway, which a provider with a read budget of its own reads through while that budget
   * is spent. Absent where the client is made for one source alone, as for its checks.
   */
  readonly eventGateway?: GatewaySetting;
}

/** One kind of provider: what a viewer is shown it as, and how one is made from a gateway's settings. */
export interface ProviderKind {
  readonly label: string;
  create(gateway: GatewaySetting, environment: ProviderEnvironment): SwarmProvider;
}

/** Every kind this build carries. A kind added here is offered wherever a config lists it. */
export const PROVIDER_REGISTRY: Readonly<Record<ProviderKindName, ProviderKind>> = {
  'bee-http': {
    label: 'A Bee node over HTTP',
    create: (gateway, environment) => new BeeHttpProvider({ baseUrl: gateway.url, ...environment }),
  },
  'weeb-3': {
    label: 'A Swarm node in this browser',
    create: (_gateway, environment) => new Weeb3Provider({ runtime: sharedWeeb3Runtime(), ...environment }),
  },
  freedom: {
    label: "The Freedom browser's own Swarm node",
    create: (_gateway, { eventGateway, ...environment }) =>
      new FreedomProvider({
        swarm: pageFreedomSwarm(),
        overBudget: eventGateway && new BeeHttpProvider({ baseUrl: eventGateway.url, ...environment }),
      }),
  },
};
