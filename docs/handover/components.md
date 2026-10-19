# Components

Each feature with its main components, hooks and modules, one line each. Paths are under `src/` unless written in full.

## App shell (`app/`)

| File                       | What it is                                                                                             |
| -------------------------- | ------------------------------------------------------------------------------------------------------ |
| `App.tsx`                  | The entry: wears the saved look, loads the config, renders the providers and the router                |
| `AppProvider.tsx`          | `AppContextProvider` and `useAppContext()`: the stream list, the Swarm client, sources, routing        |
| `AppChatUserProvider.tsx`  | Hands `ChatUserProvider` the chat history's Bee address, the Swarm ID site and the app's name          |
| `ThemeChoiceProvider.tsx`  | The look the viewer picked and whether the switcher is on                                              |
| `ConfigProblem.tsx`        | The page shown when `config.json` is missing or wrong                                                  |
| `routes.tsx`               | `ROUTES` and `BaseRouter`: the stream list at `/`, the watch page at `/watch/:mediatype/:owner/:topic` |
| `layout/MainLayout.tsx`    | The header with the logo and the My Swarm button, the failure bars, `<main>`                           |
| `layout/Footer/Footer.tsx` | The footer with the theme's links                                                                      |
| `browserStorage.ts`        | Guarded `localStorage` reads and writes                                                                |
| `sourceStorage.ts`         | Loads and saves the viewer's added sources and routing                                                 |
| `themeChoice.ts`           | Loads and saves `viewer-theme`, and decides which look the page wears                                  |

## Configuration (`config/`)

| File               | What it is                                                                        |
| ------------------ | --------------------------------------------------------------------------------- |
| `runtimeConfig.ts` | The zod schema, `loadRuntimeConfig`, `parseRuntimeConfig`, and the config helpers |

## Design (`design/`)

| File            | What it is                                                                |
| --------------- | ------------------------------------------------------------------------- |
| `_tokens.scss`  | The scales: sizes, spacing, type steps, radii, timing                     |
| `themes/*.scss` | Each theme's colours and typefaces over `_base.scss`                      |
| `theme.scss`    | Emits the variables under `:root` and `[data-theme]`, and the base styles |
| `themes.ts`     | Each theme's content: logo, hero, footer links, tab title and icon        |
| `themeNames.ts` | `THEME_NAMES` and `DEFAULT_THEME`, imported by the config schema          |
| `look.ts`       | `applyLook` and `applyThemeContent`                                       |
| `fonts.ts`      | The `@fontsource` imports, only the weights used                          |
| `_media.scss`   | The breakpoint mixins                                                     |

## Catalog, the stream list (`features/catalog/`)

| File                                                             | What it is                                                                                                                         |
| ---------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `StreamBrowser/StreamBrowser.tsx`                                | The browse page, with `catalogView.ts` picking the view and message                                                                |
| `StreamList/StreamList.tsx`                                      | The list: sections (`displayedStreams.ts`), paging (`pagination.ts`), search (`streamSearch.ts`)                                   |
| `FeaturedStream/FeaturedStream.tsx`                              | A live stream's block, or the next upcoming one with `countdown.ts`                                                                |
| `StreamCard/StreamCard.tsx`                                      | One stream's card, its description parsed by `streamDescription.ts`                                                                |
| `StreamPreview/StreamPreview.tsx`                                | The card's picture or decoded first frame (`previewMode.ts`, `previewSource.ts`, `previewManifest.ts`, `previewPlaylistLoader.ts`) |
| `StreamSearch/`, `Pagination/`, `WatchLink/`                     | The search box, the pager, the link to a watch page                                                                                |
| `catalogFeed.ts`                                                 | `CatalogFeedReader`: reads the stream list feed by slot through `reader('stream-list')`                                            |
| `catalogState.ts`, `catalogList.ts`                              | The catalog's state and how a new read replaces the list                                                                           |
| `catalogPoll.ts`                                                 | The poll interval (60 s), the first-load retry (5 s), the watch page's poll                                                        |
| `useCatalogPoll.ts`                                              | The SWR hook that polls the list                                                                                                   |
| `useNow.ts`                                                      | The 30 s clock the countdowns and sections read                                                                                    |
| `stream.ts`, `streamLabels.ts`, `scheduledStart.ts`, `format.ts` | The stream type and its labels, start times and formatting                                                                         |
| `watchPageView.ts`, `watchPath.ts`                               | Which view a watch page shows, and a stream's watch URL                                                                            |
| `thumbnailManifest.ts`                                           | Reads a preview's manifest through `reader('previews')`                                                                            |

## Player (`features/player/`)

| File                                                                                                                    | What it is                                                                                                                                       |
| ----------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `StreamWatcher/StreamWatcher.tsx`                                                                                       | The watch page: finds the stream, picks the view, mounts a player and the chat                                                                   |
| `StreamWatcher/WatchLayout.tsx`, `WatchPlaceholder.tsx`, `ScheduledPlaceholder.tsx`, `NotAStreamPage.tsx`               | The watch page's layout and its waiting, scheduled and not-found states                                                                          |
| `StreamWatcher/useListReadAtMarkers.ts`, `watchForLadderMarkers.ts`, `useIsWaitingForStart.ts`, `scheduledCountdown.ts` | Waiting for a scheduled stream to start                                                                                                          |
| `SwarmHlsPlayer.tsx`                                                                                                    | This app's player: hls.js with the custom loaders, overlays, recovery, resume                                                                    |
| `OwnPlayerStage.tsx`                                                                                                    | A provider's own player (weeb-3) into a bare video element                                                                                       |
| `placeAcrossSwap.ts`                                                                                                    | Keeps the place in a recording across a player swap                                                                                              |
| `playerConfig.ts`                                                                                                       | hls.js's config: the live target (12 s or three segments), gap limits, tuning                                                                    |
| `CustomManifestLoader.ts`                                                                                               | `CustomManifestLoader` and `CustomFragmentLoader`, the `manifestFetcher` and `requestJitter` singletons                                          |
| `ManifestManagement.ts`                                                                                                 | `ManifestStateManager` (the growing EVENT playlist) and `ManifestFetcher` (reads through the client)                                             |
| `LadderFeedPoller.ts`                                                                                                   | Follows the playing quality's feed, and the one being switched to                                                                                |
| `newestIndexFinder.ts`, `markerFinder.ts`, `ladderMarkerReads.ts`, `rungHeadMarkers.ts`                                 | Finding the newest playlist from markers or by search                                                                                            |
| `following/`                                                                                                            | `followPredicted.ts`, `findNewestFromScratch.ts`, `findNewestFromHint.ts`, `searchRounds.ts`, `probeAhead.ts`, `headMarkers.ts`, `feedReader.ts` |
| `feedState.ts`, `rungHealth.ts`, `rungPosition.ts`, `rungFeedReader.ts`, `refusedSlot.ts`                               | A quality's health and position                                                                                                                  |
| `feedReturn.ts`, `returningBroadcast.ts`, `resumeOnReturn.ts`, `restartResume.ts`, `mediaErrorRecovery.ts`              | A broadcast that returns, the page coming back, restarts                                                                                         |
| `liveSegmentGaps.ts`, `liveSyncLength.ts`, `playbackHealth.ts`, `segmentLoads.ts`, `segmentNames.ts`                    | Gaps, latency, stalls, segment loads                                                                                                             |
| `sourceMissCost.ts`                                                                                                     | Measures a slow source and sets the budgets                                                                                                      |
| `ladderCompletionWatch.ts`                                                                                              | Reads the next stream list slot when a marker names a quality the entry lacks                                                                    |
| `playableRenditions.ts`, `playlist.ts`, `playerReads.ts`, `waitMs.ts`                                                   | Renditions, playlist parsing, reads, waiting                                                                                                     |
| `overlays/feed/FeedStateOverlay.tsx`                                                                                    | The line under the player about the feed's state                                                                                                 |
| `overlays/qoe/`                                                                                                         | The playback quality panel: `QoeOverlay.tsx`, `QoePanel.tsx`, `useHlsQoeMetrics.ts`, export, geometry, fullscreen, storage                       |

## Chat (`features/chat/`)

| File                                                                                                                                       | What it is                                                                                                                                                                                                                                                    |
| ------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `WatchChat.tsx`                                                                                                                            | Lazy-loads the chat as its own chunk beside the video                                                                                                                                                                                                         |
| `Chat/Chat.tsx`                                                                                                                            | The panel: messages, sender, threads, reactions, the stamp warning bar                                                                                                                                                                                        |
| `Chat/ChatMessage/`                                                                                                                        | One message: `SenderLine`, `MessageActions`, `MessageDetails`, reactions, threads, `OwnFeedCheck`                                                                                                                                                             |
| `Chat/MessageSender/`, `Chat/EmojiPicker/`, `Chat/ThreadView/`, `Chat/ScrollableMessageList/`, `Chat/FeedNotice/`, `Chat/StampWarningBar/` | The field, the pickers, a thread, the list, notices                                                                                                                                                                                                           |
| `useSwarmChat.ts`                                                                                                                          | The hook that runs the chat library per stream: messages, status, sending, restarts                                                                                                                                                                           |
| `chatSettings.ts`                                                                                                                          | Builds the library's settings per stream from the config and the session                                                                                                                                                                                      |
| `chatParts.ts`                                                                                                                             | Adapts the Swarm client's chat reader and the write into the library's source                                                                                                                                                                                 |
| `User.tsx`                                                                                                                                 | `ChatUserProvider` and `useChatUser()`: guest and Swarm ID sessions, sign-in and out                                                                                                                                                                          |
| `auth/login.ts`, `auth/persistence.ts`                                                                                                     | Guest names, the guest key, `stream-event-client:chat-session`                                                                                                                                                                                                |
| `swarmId/`                                                                                                                                 | `swarmIdLibrary.ts` (the one importer of the library), the sign-in state machine, the button's look and fonts                                                                                                                                                 |
| `stamp/`                                                                                                                                   | `ChatStamp.tsx` (who pays, the stamp's figures), `chatStampChoice.ts`, `ownStampRoute.ts`, `ownStampWrite.ts`, `ownFeedCopies.ts`, `ownFeedComparison.ts`, `useOwnFeedComparison.ts`, `OwnFeedChat.tsx`, `siteStamp.ts`, `stampProblems.ts`, `chatSending.ts` |
| `verify/`                                                                                                                                  | `messageVerifier.ts`, `chatVerifier.ts`, `verify.worker.ts`, `verdicts.ts`: signatures checked in a worker                                                                                                                                                    |
| `ens/`                                                                                                                                     | `ensLookup.ts` and `EnsNames.tsx`: ENS names through `ensRpcUrl`                                                                                                                                                                                              |
| `ownersChunk.ts`, `reactions.ts`, `draftCheck.ts`                                                                                          | The owner check on a chunk, reaction grouping, message size limits                                                                                                                                                                                            |

## Connect, My Swarm (`features/connect/`)

| File                   | What it is                                                                               |
| ---------------------- | ---------------------------------------------------------------------------------------- |
| `Connect.tsx`          | The header button and the dialog, with its views: menu, add, add-source, source, leave   |
| `ConnectContext.tsx`   | `ConnectProvider` and `useConnect()`: whether the panel is open and which view           |
| `IdSection.tsx`        | Guest name, Chat as guest, Sign in with Swarm ID, the signed-in account, the theme group |
| `ThemeOptions.tsx`     | The theme switcher's radio group with swatches                                           |
| `ChatStampSection.tsx` | Gateway pays or My stamp, the stamp's figures, Change stamp                              |
| `OwnFeedSync.tsx`      | The own-feed count and the Sync button                                                   |
| `SwarmAccess.tsx`      | The list of sources with status dots                                                     |
| `UseFor.tsx`           | All features or Per feature, a select per part                                           |
| `AddSourceViews.tsx`   | The add tiles, the address form for a gateway or a Bee node, the Weeb3 add view          |
| `SourceSettings.tsx`   | A source's name, address, Test connection, Copy diagnostics, Remove                      |
| `CheckList.tsx`        | The check lines with ✓, ✕ or –                                                           |
| `useSourceChecks.ts`   | `useCheckClient()` and `useSourceChecks()`: a client for one source and its check run    |
| `FailureBars.tsx`      | One bar per part with no usable answer for 10 s                                          |
| `connectWords.ts`      | Every label and sentence of the panel                                                    |

## Gateway, the source checks (`features/gateway/`)

| File                                             | What it is                                                                               |
| ------------------------------------------------ | ---------------------------------------------------------------------------------------- |
| `sourceChecks.ts`                                | `runSourceChecks`: the full check run before adding and on Test connection               |
| `checkWords.ts`, `checkSentences.ts`             | Each check's line, each failure's reason and fix, CORS and local-network help            |
| `sourceStatus.ts`                                | `checkSourceStatus`: the light check behind the status dot                               |
| `useSourceStatuses.ts`                           | Runs the light check every 10 s while My Swarm is open                                   |
| `eventContent.ts`                                | Finds a stream, playlist and segment of the event for the reads to check                 |
| `gatewayProbe.ts`                                | Address rules: `checkSourceAddress`, `checkOwnNodeAddress`, mixed content, `onlyGateway` |
| `reachability.ts`                                | Why a Bee node on the local network cannot be reached, through the Permissions API       |
| `providerStatus.ts`, `report.ts`                 | The per-part rows and the Copy diagnostics text                                          |
| `useNodeInTabStatus.ts`, `NodeInTabProgress.tsx` | The node in the tab's download and peers, as a line                                      |
| `StatusDot.tsx`, `HelpSteps.tsx`                 | The dot and the steps of a fix                                                           |

## Shared (`shared/`)

| File                                                                                 | What it is                                                                     |
| ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------ |
| `catalog.ts`, `contracts/`, `streamStatus.ts`, `mediaType.ts`                        | The stream list format, copied from streaming-monorepo                         |
| `feedFollow.ts`, `ladderMarker.ts`, `manifest.ts`, `masterPlaylist.ts`, `hlsTags.ts` | Feed requests, markers, playlists, copied the same way                         |
| `gatewayClock.ts`                                                                    | The gateway's clock from `Date` headers                                        |
| `requestJitter.ts`, `abrTuning.ts`                                                   | Request spreading and hls.js tuning                                            |
| `buildLabel.ts`                                                                      | `BUILD_LABEL` and `WEEB3_VERSION` as the build defined them                    |
| `nodeInTabStatus.ts`, `mySwarmPanel.ts`                                              | weeb-3's status words and `useNodeStatus`, the panel's name                    |
| `fetchTimeoutError.ts`                                                               | The error a timed-out read throws                                              |
| `components/`                                                                        | `Button`, `Dialog`, `Spinner`, `SocialLinks`, `Address/ShortAddress`, `Icons/` |

## Swarm (`swarm/`)

| File                                             | What it is                                                                                                                                            |
| ------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `provider.ts`                                    | `SwarmProvider`, `ProbeResult`, `ProviderStatus`, `OwnPlayer`, the read options and defaults                                                          |
| `answers.ts`                                     | `SwarmAnswer`: content, not-found, rate-limited, unsupported, unavailable, aborted                                                                    |
| `client.ts`                                      | `SwarmClient`, `SwarmReader`, `SWARM_FEATURES`, counts, activity, failures, the clock                                                                 |
| `createSwarmClient.ts`                           | Makes the client from the settings, the choice and the routes through the registry                                                                    |
| `providerKinds.ts`, `registry.ts`                | The kinds and how each is made                                                                                                                        |
| `settings.ts`                                    | `GatewaySetting`, `SwarmSettings`, `swarmSettingsFrom(config)`, `gatewayName`                                                                         |
| `sources.ts`                                     | Source types, added sources, their names, settings and storage format                                                                                 |
| `routing.ts`                                     | Which source each part reads from, and its storage format                                                                                             |
| `addressSpace.ts`                                | Public, local and loopback addresses, local-network support                                                                                           |
| `featureFailures.ts`                             | A part's failures over time, for the failure bars                                                                                                     |
| `httpRead.ts`, `boundedRequest.ts`, `urlLoad.ts` | Bounded HTTP reads and URL loads                                                                                                                      |
| `singleOwnerChunk.ts`, `chunkSpan.ts`            | The single-owner chunk codec and the span                                                                                                             |
| `providers/bee-http/`                            | `beeHttpProvider.ts`, `beeNodeState.ts`, `gsocWrite.ts`, `stampedSocUpload.ts`                                                                        |
| `providers/weeb-3/`                              | `weeb3Provider.ts`, `weeb3Runtime.ts`, `weeb3Module.ts`, `weeb3Package.ts`, `weeb3Playback.ts`, `weeb3Hls.ts`, `weeb3Push.ts`, `newestEntrySearch.ts` |
