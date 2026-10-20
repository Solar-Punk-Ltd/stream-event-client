import { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Topic } from '@ethersphere/bee-js';

import { manifestFetcher } from '@/features/player/CustomManifestLoader';
import { ManifestStateManager } from '@/features/player/ManifestManagement';
import { Stream } from '@/features/catalog/stream';
import { CatalogFeedReader } from '@/features/catalog/catalogFeed';
import {
  type ChatConfig,
  enabledChat,
  experimentalEnabled,
  type RuntimeConfig,
  selectedTheme,
} from '@/config/runtimeConfig';
import { THEME_CONTENT, type ThemeContent } from '@/design/themes';
import { gatewayClock } from '@/shared/gatewayClock';
import type { SwarmClient, SwarmReader } from '@/swarm/client';
import { createSwarmClient } from '@/swarm/createSwarmClient';
import { type PartSources, resolveRouting, type Routing, withoutSource } from '@/swarm/routing';
import { type SwarmSettings, swarmSettingsFrom } from '@/swarm/settings';
import {
  type AddedSource,
  addSource as withSourceAdded,
  allSources,
  chatHistorySettingOf,
  gatewaySettingOf,
  type NewSource,
  removeSource as withSourceRemoved,
  renameSource as withSourceRenamed,
  hasAddress,
  type Source,
} from '@/swarm/sources';

import { CatalogRead, catalogUpdater, StreamCatalog, toCatalogRead } from '@/features/catalog/catalogState';

import { browserStorage } from './browserStorage';
import { loadSourceChoices, saveAddedSources, saveRouting, type SourceChoices } from './sourceStorage';

type AppContextState = {
  streamList: Stream[];
  /** The stream list feed's entry {@link streamList} was read from, or null before a read named one. */
  streamListSlot: bigint | null;
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
   * ladder short or that found a ladder marker while waiting on an announced stream. One slot and never
   * the one after it, which is not written yet and which Bee would hide for a minute if asked early. A
   * call while one is in flight does nothing.
   */
  readNextStreamListSlot: () => void;
  /** The one way the app reads Swarm, each part from its own source and nothing else. */
  swarm: SwarmClient;
  /**
   * The chat reader of the client in use when it is called, on the source picked for the chat history.
   * The same function for the life of the page, so a running chat follows a rebuilt client.
   */
  chatReads: () => SwarmReader;
  /**
   * The source picked for the chat history as the base URL of a Bee node's API, which Swarm ID reads the chat
   * through for this site, or null for a source with no such address, the node in this browser.
   */
  chatHistoryBeeUrl: string | null;
  /** The gateways this deployment offers, and its default. */
  swarmSettings: SwarmSettings;
  /** The stream list feed this event publishes, which the checks of a source read. */
  catalogFeed: { readonly owner: string; readonly topic: string };
  /** The deployment's gateways, then the gateways and Bee nodes the viewer added. */
  sources: readonly Source[];
  /** How the viewer chose to route the parts, as saved. */
  routing: Routing;
  /** The source each part reads from now, which is {@link routing} with any source that is gone replaced. */
  parts: PartSources;
  /** The source the stream list reads from, which the stream list on screen is tagged with. */
  streamListSourceId: string;
  /** Adds a source and answers its id. */
  addSource: (source: NewSource) => string;
  renameSource: (id: string, name: string) => void;
  /** Removes a source the viewer added. Whatever read from it reads from the default gateway. */
  removeSource: (id: string) => void;
  setRouting: (routing: Routing) => void;
  /** The chat's settings, or null when this deployment has chat switched off. */
  chat: ChatConfig | null;
  /** Whether this deployment offers Swarm ID and the viewer's own choice of sources, the `experimental` setting. */
  experimental: boolean;
  /** The logo, words and links of this deployment's theme, which stay when a viewer switches the look. */
  themeContent: ThemeContent;
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

const sourceOf = (sources: readonly Source[], id: string) => sources.find((candidate) => candidate.id === id) ?? null;

interface Wiring {
  readonly sources: readonly Source[];
  readonly parts: PartSources;
}

function wiringOf(settings: SwarmSettings, choices: SourceChoices): Wiring {
  const sources = allSources(settings, choices.added);
  return {
    sources,
    parts: resolveRouting(choices.routing, sources, settings.defaultId),
  };
}

/** What the client is made from, so a change that leaves it alone, such as a rename, does not make it again. */
function clientKey({ sources, parts }: Wiring): string {
  const urlOf = (id: string) => sources.find((source) => source.id === id)?.url ?? id;
  return JSON.stringify(Object.entries(parts).map(([part, id]) => [part, id, urlOf(id)]));
}

/**
 * The client for the parts' sources, sharing the one gateway clock the player's time markers read, so
 * the player's answers correct it as well as the stream list's. The chat history reads from its source
 * where that source serves the chat's paths, which for the event gateway is the chat read address.
 */
function swarmClientFor(settings: SwarmSettings, wiring: Wiring, chat: ChatConfig | null): SwarmClient {
  const { sources, parts } = wiring;
  const player = sourceOf(sources, parts.player);
  const routes = Object.fromEntries(
    (['stream-list', 'previews', 'chat'] as const).flatMap((part) => {
      const source = sourceOf(sources, parts[part]);
      if (source === null) {
        return [];
      }
      const gateway =
        part === 'chat'
          ? chatHistorySettingOf(source, settings.defaultId, chat?.readUrl ?? null)
          : gatewaySettingOf(source);
      return [[part, gateway]];
    }),
  );
  return createSwarmClient(settings, {
    choice: player ? gatewaySettingOf(player) : undefined,
    routes,
    client: { clock: gatewayClock },
  });
}

/** An address the browser reaches, a path on this site such as `/bee` resolved against the page. */
function absoluteUrl(url: string): string {
  return new URL(url, typeof location === 'undefined' ? 'http://localhost' : location.origin).href.replace(/\/+$/, '');
}

export const AppContextProvider = ({ config, children }: Props) => {
  const settings = useMemo(() => swarmSettingsFrom(config), [config]);
  const chat = useMemo(() => enabledChat(config), [config]);
  const experimental = experimentalEnabled(config);
  // With the experimental parts off the saved choices are neither read nor written, so they come back unchanged
  // once the deployment turns them on again.
  const [choiceStorage] = useState(() => (experimental ? browserStorage() : null));
  const [catalog, setCatalog] = useState<StreamCatalog>({ streams: [], gateway: null, slot: null });
  const [isStreamListLoaded, setIsStreamListLoaded] = useState(false);
  const [choices, setChoices] = useState<SourceChoices>(() => loadSourceChoices(settings, choiceStorage));
  const wiring = useMemo(() => wiringOf(settings, choices), [settings, choices]);
  const [swarm, setSwarm] = useState<SwarmClient>(() => {
    const client = swarmClientFor(settings, wiring, chat);
    manifestFetcher.useSwarm(client.reader('player'));
    return client;
  });
  const swarmRef = useRef(swarm);
  const chatReads = useCallback(() => swarmRef.current.reader('chat'), []);
  const chatHistoryBeeUrl = useMemo(() => {
    const source = sourceOf(wiring.sources, wiring.parts.chat);
    if (source === null || !hasAddress(source.type)) {
      return null;
    }
    return absoluteUrl(chatHistorySettingOf(source, settings.defaultId, chat?.readUrl ?? null).url);
  }, [wiring, settings, chat]);
  const choicesRef = useRef(choices);
  const clientKeyRef = useRef(clientKey(wiring));

  const streamListSourceRef = useRef(wiring.parts['stream-list']);

  /**
   * Take the viewer's new choices, remember them, and point every later read where they say.
   *
   * ⛔ **The stream list is not cleared here, on purpose.** What a
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
      saveAddedSources(added, choiceStorage);
      applyChoices({ ...choicesRef.current, added });
      return id;
    },
    [applyChoices, choiceStorage],
  );

  const renameSource = useCallback(
    (id: string, name: string) => {
      const added = withSourceRenamed(choicesRef.current.added, id, name);
      saveAddedSources(added, choiceStorage);
      applyChoices({ ...choicesRef.current, added });
    },
    [applyChoices, choiceStorage],
  );

  const removeSource = useCallback(
    (id: string) => {
      const added: AddedSource[] = withSourceRemoved(choicesRef.current.added, id);
      const routing = withoutSource(choicesRef.current.routing, id, settings.defaultId);
      saveAddedSources(added, choiceStorage);
      saveRouting(routing, choiceStorage);
      applyChoices({ ...choicesRef.current, added, routing });
    },
    [applyChoices, settings, choiceStorage],
  );

  const setRouting = useCallback(
    (routing: Routing) => {
      saveRouting(routing, choiceStorage);
      applyChoices({ ...choicesRef.current, routing });
    },
    [applyChoices, choiceStorage],
  );

  /**
   * Kept in a ref rather than rebuilt per call, because its whole value is the position it remembers
   * between polls. A reader recreated on each render would resolve the head every time.
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
      .catch((error: unknown) => console.warn("Could not read the stream list's next slot:", error))
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

  // A node in this browser runs while any part reads from it, so it is ready when a page needs it and stops once
  // every part has moved off it. Every other source starts and stops with nothing to do.
  useEffect(() => {
    void swarm.start().catch(() => undefined);
    return () => void swarm.stop();
  }, [swarm]);

  return (
    <AppContext.Provider
      value={{
        streamList: catalog.streams,
        streamListSlot: catalog.slot,
        isStreamListLoaded,
        isStreamListFromCurrentGateway: catalog.gateway === wiring.parts['stream-list'],
        setNewStreamList,
        fetchAppState,
        readNextStreamListSlot,
        swarm,
        chatReads,
        chatHistoryBeeUrl,
        swarmSettings: settings,
        catalogFeed: config.catalog,
        sources: wiring.sources,
        routing: choices.routing,
        parts: wiring.parts,
        streamListSourceId: wiring.parts['stream-list'],
        addSource,
        renameSource,
        removeSource,
        setRouting,
        chat,
        experimental,
        themeContent: THEME_CONTENT[selectedTheme(config)],
      }}
    >
      {children}
    </AppContext.Provider>
  );
};
