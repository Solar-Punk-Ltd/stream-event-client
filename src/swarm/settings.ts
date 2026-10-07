import type { GatewayConfig, RuntimeConfig } from '@/config/runtimeConfig';

import { PROVIDER_KINDS, type ProviderKindName } from './providerKinds';

/** One gateway as the settings name it, which a provider kind in the registry makes a provider from. */
export type GatewaySetting = GatewayConfig;

/** What the Swarm client is made from, whichever way the deployment's config wrote it. */
export interface SwarmSettings {
  readonly gateways: readonly GatewaySetting[];
  readonly defaultId: string;
  /** The gateway asked when the one in use fails, or null for none. */
  readonly fallbackId: string | null;
  /** The kinds of provider a viewer may add one of their own of. */
  readonly kinds: readonly ProviderKindName[];
}

/** The id the one gateway of a config that names only `gatewayUrl` goes by. */
export const SINGLE_GATEWAY_ID = 'gateway';

/**
 * The settings a config describes. A config written before `providers` existed names one gateway,
 * `gatewayUrl`, and that is read as the only gateway offered and the default, with no fallback, so a
 * deployment needs no change to its settings.
 */
export function swarmSettingsFrom(config: Pick<RuntimeConfig, 'gatewayUrl' | 'providers'>): SwarmSettings {
  const { providers } = config;
  if (!providers) {
    return {
      gateways: [{ id: SINGLE_GATEWAY_ID, kind: 'bee-http', url: config.gatewayUrl }],
      defaultId: SINGLE_GATEWAY_ID,
      fallbackId: null,
      kinds: [...PROVIDER_KINDS],
    };
  }
  return {
    gateways: providers.gateways,
    defaultId: providers.default,
    fallbackId: providers.fallback ?? null,
    kinds: providers.kinds ?? [...PROVIDER_KINDS],
  };
}
