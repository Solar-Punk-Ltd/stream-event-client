import { type RuntimeConfig, weeb3Bootnodes } from '@/config/runtimeConfig';

import type { ProviderKindName } from './providerKinds';

/**
 * One source as the settings name it, which a provider kind in the registry makes a provider from. A
 * gateway the config offers is one of these, and so is a source a viewer added.
 */
export interface GatewaySetting {
  readonly id: string;
  readonly kind: ProviderKindName;
  readonly label?: string;
  /** Empty for a kind that is reached by no address, such as a node running in this browser. */
  readonly url: string;
}

/** What the Swarm client is made from, whichever way the deployment's config wrote it. */
export interface SwarmSettings {
  readonly gateways: readonly GatewaySetting[];
  readonly defaultId: string;
  /** The peers the node in this browser dials first, `weeb3.bootnodes` in the config. Absent, the package's own list. */
  readonly weeb3Bootnodes?: readonly string[];
}

/** The id the one gateway of a config that names only `gatewayUrl` goes by. */
export const SINGLE_GATEWAY_ID = 'gateway';

/**
 * The settings a config describes. A config that names only `gatewayUrl`, one gateway, is read as the only gateway
 * offered and the default.
 */
export function swarmSettingsFrom(config: Pick<RuntimeConfig, 'gatewayUrl' | 'providers' | 'weeb3'>): SwarmSettings {
  const { providers, gatewayUrl } = config;
  const bootnodes = weeb3Bootnodes(config);
  // Left out rather than empty when the config names none, so settings without the setting stay as they were.
  const weeb3 = bootnodes.length > 0 ? { weeb3Bootnodes: bootnodes } : {};
  if (!providers) {
    if (gatewayUrl === undefined) {
      // The config's own check refuses a config with neither, so only a caller that skipped it lands here.
      throw new Error('a config names its gateways in providers or in gatewayUrl');
    }
    return {
      gateways: [{ id: SINGLE_GATEWAY_ID, kind: 'bee-http', url: gatewayUrl }],
      defaultId: SINGLE_GATEWAY_ID,
      ...weeb3,
    };
  }
  return {
    gateways: providers.gateways,
    defaultId: providers.default,
    ...weeb3,
  };
}

/**
 * What a viewer is shown a provider as: its label, or what it is. Never its address, so a name can go
 * anywhere an address must not, such as the diagnostics a viewer copies.
 */
export function gatewayName(settings: SwarmSettings, id: string): string {
  const offered = settings.gateways.find((gateway) => gateway.id === id);
  if (offered?.label) {
    return offered.label;
  }
  return id === settings.defaultId ? 'Event gateway' : `Gateway ${id}`;
}
