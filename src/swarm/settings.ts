import type { RuntimeConfig } from '@/config/runtimeConfig';

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
}

/** The id the one gateway of a config that names only `gatewayUrl` goes by. */
export const SINGLE_GATEWAY_ID = 'gateway';

/**
 * The settings a config describes. A config written before `providers` existed names one gateway,
 * `gatewayUrl`, and that is read as the only gateway offered and the default, so a deployment needs no
 * change to its settings.
 */
export function swarmSettingsFrom(config: Pick<RuntimeConfig, 'gatewayUrl' | 'providers'>): SwarmSettings {
  const { providers, gatewayUrl } = config;
  if (!providers) {
    if (gatewayUrl === undefined) {
      // The config's own check refuses a config with neither, so only a caller that skipped it lands here.
      throw new Error('a config names its gateways in providers or in gatewayUrl');
    }
    return {
      gateways: [{ id: SINGLE_GATEWAY_ID, kind: 'bee-http', url: gatewayUrl }],
      defaultId: SINGLE_GATEWAY_ID,
    };
  }
  return {
    gateways: providers.gateways,
    defaultId: providers.default,
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
