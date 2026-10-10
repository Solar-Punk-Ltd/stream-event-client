import type { RuntimeConfig } from '@/config/runtimeConfig';

import { type BeeNodeAccess, DEFAULT_BEE_NODE_ACCESS } from './beeNodeAccess';
import { GATEWAY_KINDS, type ProviderKindName } from './providerKinds';

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
  /**
   * The gateways asked in this order when the one in use fails, the default always last, or none when
   * the deployment switched the fallback off. A feature's own gateway is left out of its list.
   */
  readonly fallbackOrder: readonly string[];
  /** The kinds of provider a viewer may add one of their own of, weeb-3 among them where the deployment allows it. */
  readonly kinds: readonly ProviderKindName[];
  /** How far a Bee node of the viewer's own may be, which the Sources screen holds to. */
  readonly beeNodes: BeeNodeAccess;
}

/** The id the one gateway of a config that names only `gatewayUrl` goes by. */
export const SINGLE_GATEWAY_ID = 'gateway';

/**
 * The settings a config describes. A config written before `providers` existed names one gateway,
 * `gatewayUrl`, and that is read as the only gateway offered, the default and the fallback, so a
 * deployment needs no change to its settings and a viewer on a node of their own still has the event
 * gateway behind them. The fallback is the default gateway unless the config names others first or
 * switches it off, and the default is always asked last.
 */
export function swarmSettingsFrom(config: Pick<RuntimeConfig, 'gatewayUrl' | 'providers' | 'weeb3'>): SwarmSettings {
  const { providers, gatewayUrl } = config;
  const inBrowser: ProviderKindName[] = config.weeb3?.enabled ? ['weeb-3'] : [];
  if (!providers) {
    if (gatewayUrl === undefined) {
      // The config's own check refuses a config with neither, so only a caller that skipped it lands here.
      throw new Error('a config names its gateways in providers or in gatewayUrl');
    }
    return {
      gateways: [{ id: SINGLE_GATEWAY_ID, kind: 'bee-http', url: gatewayUrl }],
      defaultId: SINGLE_GATEWAY_ID,
      fallbackOrder: [SINGLE_GATEWAY_ID],
      kinds: [...GATEWAY_KINDS, ...inBrowser],
      beeNodes: DEFAULT_BEE_NODE_ACCESS,
    };
  }
  return {
    gateways: providers.gateways,
    defaultId: providers.default,
    fallbackOrder: providers.fallback === false ? [] : [...[providers.fallback ?? []].flat(), providers.default],
    kinds: [...(providers.kinds ?? GATEWAY_KINDS), ...inBrowser],
    beeNodes: providers.beeNodes ?? DEFAULT_BEE_NODE_ACCESS,
  };
}

/** The id a Bee node of the viewer's own goes by, one the settings do not offer. */
export const OWN_GATEWAY_ID = 'own-node';

/** The id the event's chat read address goes by in the client's counts. */
export const CHAT_READ_GATEWAY_ID = 'chat-read';

/**
 * What a viewer is shown a provider as: its label, or what it is. Never its address, so a name can go
 * anywhere an address must not, such as the diagnostics a viewer copies.
 */
export function gatewayName(settings: SwarmSettings, id: string): string {
  if (id === OWN_GATEWAY_ID) {
    return 'Your own node';
  }
  if (id === CHAT_READ_GATEWAY_ID) {
    return "The chat's gateway";
  }
  const offered = settings.gateways.find((gateway) => gateway.id === id);
  if (offered?.label) {
    return offered.label;
  }
  return id === settings.defaultId ? 'Event gateway' : `Gateway ${id}`;
}

const withoutTrailingSlash = (url: string) => url.replace(/\/+$/, '');

/**
 * The gateway an address saved before sources existed means. The node picker and the control panel
 * kept a viewer's choice as one address, so an address an offered gateway has is that gateway, and any
 * other is a Bee node of the viewer's own.
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
