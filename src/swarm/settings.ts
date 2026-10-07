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
  const { providers, gatewayUrl } = config;
  if (!providers) {
    if (gatewayUrl === undefined) {
      // The config's own check refuses a config with neither, so only a caller that skipped it lands here.
      throw new Error('a config names its gateways in providers or in gatewayUrl');
    }
    return {
      gateways: [{ id: SINGLE_GATEWAY_ID, kind: 'bee-http', url: gatewayUrl }],
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

/** The id a Bee node of the viewer's own goes by, one the settings do not offer. */
export const OWN_GATEWAY_ID = 'own-node';

const withoutTrailingSlash = (url: string) => url.replace(/\/+$/, '');

/** The gateway every reader starts on. The config's own check makes sure the default names one. */
export function defaultGateway(settings: SwarmSettings): GatewaySetting {
  return settings.gateways.find((gateway) => gateway.id === settings.defaultId) ?? settings.gateways[0];
}

/**
 * The gateway a saved or picked address means. A viewer's choice is kept as an address, which is what
 * the node picker shows and what a choice saved before `providers` existed holds, so an address an
 * offered gateway has is that gateway, and any other is a Bee node of the viewer's own.
 */
export function choiceForAddress(settings: SwarmSettings, address: string): GatewaySetting {
  const wanted = withoutTrailingSlash(address);
  return (
    settings.gateways.find((gateway) => withoutTrailingSlash(gateway.url) === wanted) ?? {
      id: OWN_GATEWAY_ID,
      kind: 'bee-http',
      url: wanted,
    }
  );
}
