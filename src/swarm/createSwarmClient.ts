import { SwarmClient, type NamedProvider, type SwarmClientOptions, type SwarmFeature } from './client';
import { sharedWeeb3Runtime } from './providers/weeb-3/weeb3Runtime';
import { PROVIDER_REGISTRY, type ProviderEnvironment, type ProviderKind } from './registry';
import type { GatewaySetting, SwarmSettings } from './settings';
import type { ProviderKindName } from './providerKinds';

export interface CreateSwarmClientOptions {
  /**
   * The viewer's choice: the id of a gateway the settings offer, or a gateway of the viewer's own such
   * as a node on their machine. Absent, or an id the settings do not offer, means the default.
   */
  readonly choice?: string | GatewaySetting;
  /** A gateway of its own for a feature. Every other feature reads from the viewer's choice. */
  readonly routes?: Partial<Record<SwarmFeature, GatewaySetting>>;
  readonly environment?: ProviderEnvironment;
  /** Injected by tests. {@link PROVIDER_REGISTRY} otherwise. */
  readonly registry?: Readonly<Record<ProviderKindName, ProviderKind>>;
  /** Everything else the client takes, such as the clock. */
  readonly client?: Omit<SwarmClientOptions, 'chosen' | 'routes'>;
}

/** The Swarm client the settings and the viewer's choice describe, its providers made by their kinds. */
export function createSwarmClient(settings: SwarmSettings, options: CreateSwarmClientOptions = {}): SwarmClient {
  const { choice, routes = {}, environment = {}, registry = PROVIDER_REGISTRY } = options;
  // The node in this browser is one per page, shared by every client and by the chat's push on the viewer's own stamp,
  // which starts it without a provider. The page makes a client from the deployment's settings before anything starts
  // the node, so this is where their bootnodes reach it in time. A client made from settings that name none, such as
  // a source check's client for one source alone, leaves the list as the page set it rather than taking it away.
  if (settings.weeb3Bootnodes !== undefined) {
    sharedWeeb3Runtime().useBootnodes(settings.weeb3Bootnodes);
  }
  const offered = (id: string | null) => settings.gateways.find((gateway) => gateway.id === id) ?? null;
  const make = (gateway: GatewaySetting): NamedProvider => ({
    id: gateway.id,
    provider: registry[gateway.kind].create(gateway, environment),
  });

  const chosen =
    (typeof choice === 'string' ? offered(choice) : choice) ?? offered(settings.defaultId) ?? settings.gateways[0];

  return new SwarmClient({
    ...options.client,
    chosen: make(chosen),
    routes: Object.fromEntries(Object.entries(routes).map(([feature, gateway]) => [feature, make(gateway)])) as Partial<
      Record<SwarmFeature, NamedProvider>
    >,
  });
}
