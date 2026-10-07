import { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Topic } from '@ethersphere/bee-js';

import { manifestFetcher } from '@/features/player/CustomManifestLoader';
import { ManifestStateManager } from '@/features/player/ManifestManagement';
import { Stream } from '@/features/catalog/stream';
import { CatalogFeedReader } from '@/features/catalog/catalogFeed';
import { type ChatConfig, enabledChat, type RuntimeConfig, selectedTheme } from '@/config/runtimeConfig';
import { THEMES, type ThemeSettings } from '@/design/themes';
import { gatewayClock } from '@/shared/gatewayClock';
import type { SwarmClient } from '@/swarm/client';
import { createSwarmClient } from '@/swarm/createSwarmClient';
import { choiceForAddress, defaultGateway, type SwarmSettings, swarmSettingsFrom } from '@/swarm/settings';

import { CatalogRead, catalogUpdater, StreamCatalog, toCatalogRead } from '@/features/catalog/catalogState';

type AppContextState = {
  streamList: Stream[];
  /**
   * Whether the catalog has been read at least once, successfully or not.
   *
   * A stream's ABR ladder lives in the catalog, so a page opened directly on /watch knows nothing
   * about it until this flips. Mounting the player before then would start it as single-rendition
   * and rebuild it the moment the ladder arrived, losing playback position on every deep link.
   *
   * ⛔ Not reset by a gateway switch, and that is deliberate. The ladder belongs to the broadcast
   * rather than to the node serving it, and the watch page keeps no catalog poll while the player is showing, so
   * clearing this there would unmount the player and leave nothing to bring it back.
   */
  isStreamListLoaded: boolean;
  /**
   * Whether {@link streamList} came from the gateway now selected.
   *
   * False from the moment a viewer switches node until that node's own answer lands. The browse page
   * then says it is still looking rather than showing another node's streams, and the watch page
   * keeps the ladder it has, which is a property of the broadcast and not of the gateway.
   */
  isStreamListFromCurrentGateway: boolean;
  setNewStreamList: (read: CatalogRead) => void;
  fetchAppState: () => Promise<CatalogRead>;
  /** The one way the app reads Swarm, on the gateway the viewer chose with the deployment's fallback behind it. */
  swarm: SwarmClient;
  /** The address of the gateway the viewer chose, which the node picker shows and the stream list is tagged with. */
  gatewayUrl: string;
  setGatewayUrl: (url: string) => void;
  /** The address of the gateway this deployment reads by default, which the picker offers as the way back. */
  defaultGatewayUrl: string;
  /** The chat's settings, or null when this deployment has chat switched off. */
  chat: ChatConfig | null;
  /** The logo and page copy of the theme this deployment wears. */
  theme: ThemeSettings;
};

const AppContext = createContext<AppContextState | undefined>(undefined);

export const useAppContext = () => {
  const context = useContext(AppContext);
  if (!context) {
    throw new Error('useAppContext must be used within AppContextProvider');
  }
  return context;
};

type Props = {
  config: RuntimeConfig;
  children: ReactNode;
};

/** Where a viewer's chosen gateway survives a reload. */
const GATEWAY_STORAGE_KEY = 'swarm-gateway-url';

function loadGatewayUrl(defaultGatewayUrl: string): string {
  try {
    return localStorage.getItem(GATEWAY_STORAGE_KEY) || defaultGatewayUrl;
  } catch {
    return defaultGatewayUrl;
  }
}

/**
 * The client for the gateway at `address`, sharing the one gateway clock the player's time markers
 * read, so every answer's server time corrects them and not only the stream list's.
 */
function swarmClientFor(settings: SwarmSettings, address: string): SwarmClient {
  return createSwarmClient(settings, { choice: choiceForAddress(settings, address), client: { clock: gatewayClock } });
}

export const AppContextProvider = ({ config, children }: Props) => {
  const settings = useMemo(() => swarmSettingsFrom(config), [config]);
  const defaultGatewayUrl = defaultGateway(settings).url;
  const [catalog, setCatalog] = useState<StreamCatalog>({ streams: [], gateway: null, slot: null });
  const [isStreamListLoaded, setIsStreamListLoaded] = useState(false);
  const [gatewayUrl, setGatewayUrlState] = useState<string>(() => {
    const url = loadGatewayUrl(defaultGatewayUrl);
    manifestFetcher.beeUrl = url;
    return url;
  });
  const [swarm, setSwarm] = useState<SwarmClient>(() => swarmClientFor(settings, gatewayUrl));

  const gatewayRef = useRef(gatewayUrl);

  /**
   * Point every subsequent read at another node.
   *
   * ⛔ **The stream list is not cleared here, and that is the fix rather than an omission.** What a
   * switch changes is whose answer the list is, which the gateway held beside it already records, so
   * the browse page stops showing it from this moment without anything being thrown away. Clearing
   * it would reach the watch page too, where a player is mounted on a ladder read out of it and
   * nothing polls the catalog to put one back: the viewer's own node would cost them the ladder, the
   * playback position, or the whole player.
   */
  const setGatewayUrl = useCallback(
    (url: string) => {
      const trimmed = url.replace(/\/+$/, '');
      gatewayRef.current = trimmed;
      setGatewayUrlState(trimmed);
      setSwarm(swarmClientFor(settings, trimmed));
      manifestFetcher.beeUrl = trimmed;
      // The new node has its own view of the feed, so a position established against the old one would
      // ask it for slots it may not hold, which reads as a catalog that stopped rather than one being
      // followed from the wrong place.
      catalogReader.current.reset();
      ManifestStateManager.getInstance().markAllDirty();
      try {
        localStorage.setItem(GATEWAY_STORAGE_KEY, trimmed);
      } catch {
        // localStorage unavailable
      }
    },
    [settings],
  );

  /**
   * Kept in a ref rather than rebuilt per call, because its whole value is the position it remembers
   * between polls. A reader recreated on each render would resolve the head every time, which is the
   * cost this replaces.
   */
  const catalogReader = useRef(new CatalogFeedReader(config.catalog.owner, Topic.fromString(config.catalog.topic)));

  /**
   * A read that landed, with the feed slot its body came from, and a null body when nothing was newer
   * than the last poll.
   *
   * The head is resolved once, on the first call, and every call after asks for the slot after the
   * one it holds. See `CatalogFeedReader` for why that is worth about a thousand times at the median.
   */
  const fetchAppState = useCallback(async (): Promise<CatalogRead> => {
    const gateway = gatewayRef.current;
    return toCatalogRead(gateway, await catalogReader.current.read(gateway));
  }, []);

  /**
   * Stable, and applied through the state it is updating rather than through a captured copy.
   *
   * ⛔ A new function on every render is what let a poll be applied twice: the browse page's effect
   * depends on this, so it re-ran on every render of this provider and handed the previous poll's
   * body back in, which would put the previous gateway's streams back on screen as the current
   * gateway's right after a switch.
   */
  const setNewStreamList = useCallback((read: CatalogRead) => {
    setCatalog(catalogUpdater(read, gatewayRef));
  }, []);

  const initAppState = useCallback(async () => {
    try {
      setNewStreamList(await fetchAppState());
    } catch (error) {
      console.error('Failed to fetch app state:', error);
    } finally {
      // Also on failure: a catalog that cannot be read is not a reason to withhold the player
      // forever, and a stream deep-linked without its ladder still plays as a single rendition.
      setIsStreamListLoaded(true);
    }
  }, [fetchAppState, setNewStreamList]);

  useEffect(() => {
    // Catches its own failure and marks the list loaded either way.
    void initAppState();
  }, [initAppState]);

  return (
    <AppContext.Provider
      value={{
        streamList: catalog.streams,
        isStreamListLoaded,
        isStreamListFromCurrentGateway: catalog.gateway === gatewayUrl,
        setNewStreamList,
        fetchAppState,
        swarm,
        gatewayUrl,
        setGatewayUrl,
        defaultGatewayUrl,
        chat: enabledChat(config),
        theme: THEMES[selectedTheme(config)],
      }}
    >
      {children}
    </AppContext.Provider>
  );
};
