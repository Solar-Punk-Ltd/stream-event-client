import { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Topic } from '@ethersphere/bee-js';

import { manifestFetcher } from '@/features/player/CustomManifestLoader';
import { ManifestStateManager } from '@/features/player/ManifestManagement';
import { Stream } from '@/features/catalog/stream';
import { CatalogFeedReader } from '@/features/catalog/catalogFeed';
import { type ChatConfig, enabledChat, type RuntimeConfig, selectedTheme } from '@/config/runtimeConfig';
import { THEMES, type ThemeSettings } from '@/design/themes';
import { gatewayClock } from '@/shared/gatewayClock';
import type { SwarmClient, SwarmReader } from '@/swarm/client';
import { createSwarmClient } from '@/swarm/createSwarmClient';
import { fallbackOrderFor } from '@/swarm/fallbackOrder';
import { CHAT_SERVICE_ID, type PartSources, resolveRouting, type Routing, withoutSource } from '@/swarm/routing';
import { CHAT_READ_GATEWAY_ID, type GatewaySetting, type SwarmSettings, swarmSettingsFrom } from '@/swarm/settings';
import {
  type AddedSource,
  addSource as withSourceAdded,
  allSources,
  gatewaySettingOf,
  type NewSource,
  removeSource as withSourceRemoved,
  renameSource as withSourceRenamed,
  type Source,
} from '@/swarm/sources';

import { CatalogRead, catalogUpdater, StreamCatalog, toCatalogRead } from '@/features/catalog/catalogState';

import {
  loadSourceChoices,
  saveAddedSources,
  saveFallbackOrder,
  saveRouting,
  type SourceChoices,
} from './sourceStorage';

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
   * Whether {@link streamList} came from the source the stream list reads from now.
   *
   * False from the moment a viewer switches node until that node's own answer lands. The browse page
   * then says it is still looking rather than showing another node's streams, and the watch page
   * keeps the ladder it has, which is a property of the broadcast and not of the gateway.
   */
  isStreamListFromCurrentGateway: boolean;
  setNewStreamList: (read: CatalogRead) => void;
  fetchAppState: () => Promise<CatalogRead>;
  /**
   * Reads the stream list's next slot once and applies it, for a watch page whose player found its
   * ladder short. One slot and never the one after it, which is not written yet and which Bee would
   * hide for a minute if asked early. A call while one is in flight does nothing.
   */
  readNextStreamListSlot: () => void;
  /** The one way the app reads Swarm, each part from its source with the order of fallbacks behind it. */
  swarm: SwarmClient;
  /**
   * The chat reader of the client in use when it is called, routed to the event's chat read address.
   * The same function for the life of the page, so a running chat follows a rebuilt client.
   */
  chatReads: () => SwarmReader;
  /** The gateways this deployment offers, its default and its fallbacks. */
  swarmSettings: SwarmSettings;
  /** The stream list feed this event publishes, which the Sources screen's checks read. */
  catalogFeed: { readonly owner: string; readonly topic: string };
  /** The deployment's gateways, then the gateways and Bee nodes the viewer added. */
  sources: readonly Source[];
  /** How the viewer chose to route the parts, as saved. */
  routing: Routing;
  /** The source each part reads from now, which is {@link routing} with any source that is gone replaced. */
  parts: PartSources;
  /** The order the fallbacks are asked in, the event gateway last, or empty when the deployment has none. */
  fallbackOrder: readonly string[];
  /** The source the stream list reads from, which the stream list on screen is tagged with. */
  streamListSourceId: string;
  /** Adds a source and answers its id. */
  addSource: (source: NewSource) => string;
  renameSource: (id: string, name: string) => void;
  /** Removes a source the viewer added. Whatever read from it reads from the default gateway. */
  removeSource: (id: string) => void;
  setRouting: (routing: Routing) => void;
  setFallbackOrder: (order: readonly string[]) => void;
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

/** What a part's source id reads from: a source, or for the chat its service, or the chosen source on a site without chat. */
function gatewayOf(sources: readonly Source[], id: string, chat: ChatConfig | null): GatewaySetting | null {
  if (id === CHAT_SERVICE_ID) {
    return chat ? { id: CHAT_READ_GATEWAY_ID, kind: 'bee-http', url: chat.readUrl } : null;
  }
  const source = sources.find((candidate) => candidate.id === id);
  return source ? gatewaySettingOf(source) : null;
}

interface Wiring {
  readonly sources: readonly Source[];
  readonly parts: PartSources;
  readonly fallbackOrder: readonly string[];
}

function wiringOf(settings: SwarmSettings, choices: SourceChoices): Wiring {
  const sources = allSources(settings, choices.added);
  return {
    sources,
    parts: resolveRouting(
      choices.routing,
      sources.map(({ id }) => id),
      settings.defaultId,
    ),
    fallbackOrder: fallbackOrderFor(settings, choices.fallbackOrder),
  };
}

/** What the client is made from, so a change that leaves it alone, such as a rename, does not make it again. */
function clientKey({ sources, parts, fallbackOrder }: Wiring): string {
  const urlOf = (id: string) => sources.find((source) => source.id === id)?.url ?? id;
  return JSON.stringify([Object.entries(parts).map(([part, id]) => [part, id, urlOf(id)]), fallbackOrder]);
}

/**
 * The client for the parts' sources, sharing the one gateway clock the player's time markers read, so
 * the player's answers correct it as well as the stream list's. The chat reads from the event's chat
 * read address unless the viewer picked another source for it, because the chat server writes its feed
 * there and the gateways the deployment offers refuse the chat's paths.
 */
function swarmClientFor(settings: SwarmSettings, wiring: Wiring, chat: ChatConfig | null): SwarmClient {
  const { sources, parts, fallbackOrder } = wiring;
  const player = gatewayOf(sources, parts.player, chat) ?? undefined;
  const routes = Object.fromEntries(
    (['stream-list', 'previews', 'chat'] as const).flatMap((part) => {
      const gateway = gatewayOf(sources, parts[part], chat);
      return gateway ? [[part, gateway]] : [];
    }),
  );
  return createSwarmClient(settings, { choice: player, routes, fallbackOrder, client: { clock: gatewayClock } });
}

export const AppContextProvider = ({ config, children }: Props) => {
  const settings = useMemo(() => swarmSettingsFrom(config), [config]);
  const chat = useMemo(() => enabledChat(config), [config]);
  const [catalog, setCatalog] = useState<StreamCatalog>({ streams: [], gateway: null, slot: null });
  const [isStreamListLoaded, setIsStreamListLoaded] = useState(false);
  const [choices, setChoices] = useState<SourceChoices>(() => loadSourceChoices(settings));
  const wiring = useMemo(() => wiringOf(settings, choices), [settings, choices]);
  const [swarm, setSwarm] = useState<SwarmClient>(() => {
    const client = swarmClientFor(settings, wiring, chat);
    manifestFetcher.useSwarm(client.reader('player'));
    return client;
  });
  const swarmRef = useRef(swarm);
  const chatReads = useCallback(() => swarmRef.current.reader('chat'), []);
  const choicesRef = useRef(choices);
  const clientKeyRef = useRef(clientKey(wiring));

  const streamListSourceRef = useRef(wiring.parts['stream-list']);

  /**
   * Take the viewer's new choices, remember them, and point every later read where they say.
   *
   * ⛔ **The stream list is not cleared here, and that is the fix rather than an omission.** What a
   * switch changes is whose answer the list is, which the source held beside it already records, so
   * the browse page stops showing it from this moment without anything being thrown away. Clearing
   * it would reach the watch page too, where a player is mounted on a ladder read out of it and
   * nothing polls the catalog to put one back: the viewer's own node would cost them the ladder, the
   * playback position, or the whole player.
   */
  const applyChoices = useCallback(
    (next: SourceChoices) => {
      choicesRef.current = next;
      setChoices(next);
      const nextWiring = wiringOf(settings, next);
      const key = clientKey(nextWiring);
      if (key === clientKeyRef.current) {
        return;
      }
      clientKeyRef.current = key;
      const client = swarmClientFor(settings, nextWiring, chat);
      swarmRef.current = client;
      setSwarm(client);
      manifestFetcher.useSwarm(client.reader('player'));
      if (nextWiring.parts['stream-list'] !== streamListSourceRef.current) {
        streamListSourceRef.current = nextWiring.parts['stream-list'];
        // The new source has its own view of the feed, so a position established against the old one
        // would ask it for slots it may not hold, which reads as a catalog that stopped rather than one
        // being followed from the wrong place.
        catalogReader.current.reset();
      }
      ManifestStateManager.getInstance().markAllDirty();
    },
    [settings, chat],
  );

  const addSource = useCallback(
    (source: NewSource) => {
      const { sources: added, id } = withSourceAdded(choicesRef.current.added, source);
      saveAddedSources(added);
      applyChoices({ ...choicesRef.current, added });
      return id;
    },
    [applyChoices],
  );

  const renameSource = useCallback(
    (id: string, name: string) => {
      const added = withSourceRenamed(choicesRef.current.added, id, name);
      saveAddedSources(added);
      applyChoices({ ...choicesRef.current, added });
    },
    [applyChoices],
  );

  const removeSource = useCallback(
    (id: string) => {
      const added: AddedSource[] = withSourceRemoved(choicesRef.current.added, id);
      const routing = withoutSource(choicesRef.current.routing, id, settings.defaultId);
      saveAddedSources(added);
      saveRouting(routing);
      applyChoices({ ...choicesRef.current, added, routing });
    },
    [applyChoices, settings],
  );

  const setRouting = useCallback(
    (routing: Routing) => {
      saveRouting(routing);
      applyChoices({ ...choicesRef.current, routing });
    },
    [applyChoices],
  );

  const setFallbackOrder = useCallback(
    (order: readonly string[]) => {
      saveFallbackOrder(order);
      applyChoices({ ...choicesRef.current, fallbackOrder: order });
    },
    [applyChoices],
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
    const source = streamListSourceRef.current;
    return toCatalogRead(source, await catalogReader.current.read(swarmRef.current.reader('stream-list')));
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
    setCatalog(catalogUpdater(read, streamListSourceRef));
  }, []);

  const nextSlotRead = useRef(false);
  const readNextStreamListSlot = useCallback(() => {
    if (nextSlotRead.current) {
      return;
    }
    nextSlotRead.current = true;
    const source = streamListSourceRef.current;
    void catalogReader.current
      .read(swarmRef.current.reader('stream-list'), undefined, 1)
      .then((snapshot) => setNewStreamList(toCatalogRead(source, snapshot)))
      .catch((error: unknown) => console.warn('Could not read the stream list for a short ladder:', error))
      .finally(() => {
        nextSlotRead.current = false;
      });
  }, [setNewStreamList]);

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
        isStreamListFromCurrentGateway: catalog.gateway === wiring.parts['stream-list'],
        setNewStreamList,
        fetchAppState,
        readNextStreamListSlot,
        swarm,
        chatReads,
        swarmSettings: settings,
        catalogFeed: config.catalog,
        sources: wiring.sources,
        routing: choices.routing,
        parts: wiring.parts,
        fallbackOrder: wiring.fallbackOrder,
        streamListSourceId: wiring.parts['stream-list'],
        addSource,
        renameSource,
        removeSource,
        setRouting,
        setFallbackOrder,
        chat,
        theme: THEMES[selectedTheme(config)],
      }}
    >
      {children}
    </AppContext.Provider>
  );
};
