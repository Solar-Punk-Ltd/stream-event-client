# The stream list and the player

What the browse page and the watch page do, and how the player reads Swarm. The stream list is
`src/features/catalog/`, the player is `src/features/player/`.

## The stream list

- **Reading it.** The list is read from a Swarm feed (`config.catalog.owner` and `topic`) and read again once a minute,
  also after a failed read, never on a longer backoff (`catalogPoll.ts`). Until the list has been shown from the
  source now selected, a failed read is tried again after 5 seconds, so a first read that fails, on load or after
  switching source, does not leave the page waiting a minute. Each read asks the list's next slot before it is written,
  and Bee skips each peer asked that early for a minute, so the page asks no more often than that. A new or changed
  entry therefore reaches an open browse page up to a minute after it is written. Once the list has been read, a slow
  or refused read of the next slot means nothing new yet, and a slot whose body does not parse is asked for again
  rather than skipped (`catalogFeed.ts`).
- **What it shows.** Every live stream gets a featured block of its own, then the next upcoming stream, the soonest
  whose start is still ahead, gets one with a countdown in days, hours and minutes. The other upcoming streams follow
  as cards: those still ahead with the soonest start first, then those whose start has passed but that have not
  gone live, labelled "Start time passed", the most recent first, then any with no start time. Past streams follow newest first, eight to a page
  (`StreamList/displayedStreams.ts`, `StreamList/pagination.ts`). The clock is read every 30 seconds, so a page left
  open moves its countdown and its feature on. A read from a newer feed slot replaces the list whatever changed in it,
  so an entry edited, unpublished or gone live in place shows on an open page without a reload.
- **Search.** The box above the list matches a stream's title, description and tags as the viewer types
  (`StreamList/streamSearch.ts`). While it holds a query the matches are one flat list, paged the same way, and a query
  that matches nothing says so.
- **Previews.** The entry's uploaded thumbnail when it has one, otherwise a frame decoded from the stream's first
  segment, with a live badge and the duration (`StreamPreview/`). A picture that failed to load from one source is
  asked again when Previews move to another. With Weeb3 a card waits with its loading indicator until the node is
  ready, and an announced stream's watch page shows its countdown without the picture until then, as
  [the node in this browser](weeb3.md) says.
- **Scheduled streams.** An entry whose state is `scheduled` has been announced and not yet broadcast. Its watch page
  says the stream has not started and reads the broadcast's ladder markers, each period's marker once, about 4 seconds
  into the period (`StreamWatcher/useListReadAtMarkers.ts`). Each marker found prompts one read of the stream list,
  and the player starts once the list says live, with the stream's renditions. Apart from that the page reads the list
  once a minute, for a new start time, a title change or an unpublish, because asking the list's unwritten next slot
  more often makes the node skip its peers for that slot and the live entry then arrives up to a minute late. If it is
  unpublished while the page waits, the page says it is no longer available.

## The watch page

The watch page is `#/watch/<mediatype>/<owner>/<topic>` (`src/app/routes.tsx`). It looks the stream up in the list,
shows the player with the source's name above it, such as "via Event gateway", and the chat beside it. With Weeb3
picked for the video it shows weeb-3's own player instead of this app's, as [weeb-3](weeb3.md) says.

- **A broadcast that comes back.** After a feed finishes, the player keeps asking for the slot after the finished
  playlist, about every 30 seconds and spread per viewer (`feedReturn.ts`). When the broadcast returns and the viewer
  has reached the end of what they were playing, the player rejoins it live.
- **Coming back to the page.** A phone that locks pauses the video, and Safari on an iPhone does not start it again on
  unlock. When the page is visible again on a live stream that is paused, playback starts again, and it catches up to
  live once the player has read the newest playlist (`resumeOnReturn.ts`). A pause the viewer made while watching,
  more than a second before the page was hidden, stays paused, a stream that is already playing is left to the player,
  and a recording is never touched. A pause the viewer makes while the page is hidden, from the lock screen's controls,
  by taking out earphones or with a media key, is undone when the page comes back.
- **Moving the video keeps the place in a recording.** When the viewer picks another source for the video while a
  recording plays, the video carries on where it was, and stays paused if it was paused. Between two gateways or Bee
  nodes the same player keeps playing and only its source changes. A move to or from Weeb3 swaps this app's player for
  weeb-3's own, so the player being taken down records where the viewer was and whether they had paused
  (`placeAcrossSwap.ts`), and the new one starts there. Each recording keeps a place of its own while the watch page
  stays open, so a recording opened again from the same page starts where the viewer left it. This app's player asks
  hls.js to start at that place and keeps asking until its first segment is in, because hls.js forgets a start
  position it is given again before then, as the play that autoplay starts does. weeb-3's player starts at the
  beginning, since weeb-3 starts only there or live, and the video is moved to the place once weeb-3's rebuilt playlist
  reaches it. Measured on 2026-10-18 on a 1483 s recording, that playlist named 8 s at first and the whole length about
  9 s later. Until then the video is held still and silent, every play weeb-3 starts is paused again, and the line
  under it says "Going to where you were in the recording", so the start of the recording never plays first. Once
  there, it plays from the place, or stays paused there if the viewer had paused. A duration that stays short of the
  place for 30 s, three times the growth measured, counts as the whole recording, and the video goes a second before its
  end instead, never back to the start. A viewer who leaves weeb-3 before it got there keeps the place they had. A live
  stream joins at its live edge in either player, as it always has, and a player that joined a broadcast live keeps no
  place for the next one, because its timeline starts where it joined.

## The quality ladder

A stream published in several qualities is one feed per quality plus a master playlist on a feed of its own. When the
stream list names the stream's renditions, the player builds the master from the list and never reads the master feed
(`src/shared/masterPlaylist.ts`). hls.js chooses the quality, and the player reads only the feed of the quality it
plays. A stream turns live once its first quality has reported, so a viewer who joins a moment before the others report
gets an entry naming only some of them, or none. The player compares the entry with the stream's time marker, the one
it reads at the start anyway and then one per 10 second period for a minute, each address once
(`ladderCompletionWatch.ts`). When a marker names a quality the entry lacks, the watch page reads the stream list's
next slot once. A quality reports before its first segment, so that slot is written by then and the read is not early.
The fuller entry rebuilds the player with every quality, which costs the viewer a moment of loading. The page never
polls the list for this.

- **How far behind live it plays.** The live target is three segments of the playlist's segment length, never under
  12 seconds, and moves when the playlist names a new length (`playerConfig.ts`, `liveSyncLength.ts`).
- **How it times its reads.** The player asks for the next playlist when it is due: the newest segment's end, plus one
  segment, plus a delay it learns from its own reads, set so that about one ask in four comes too early
  (`following/followPredicted.ts`). A second ask covers that one, then one ask per segment, then asks every 2 seconds
  rising to 4 while nothing comes. A playlist 4 seconds late is looked past, one slot further on. One viewer costs
  about 40 reads a minute.
- **When the broadcast goes quiet.** Bee skips, for a minute, every peer it asked for an address not written yet, so a
  slot asked for over and over during an outage stays unreadable for about a minute after the broadcaster is back. So
  once the next slot has had five asks, the player stops asking for it and reads the stream's time markers instead,
  each one once, 4 seconds into its 10 seconds. When a marker names a slot past the missing one, the player reads that
  slot, whose playlist also holds the segments it skips, and follows on from there. The picture is back 4 to 14
  seconds after the broadcaster has new video, where it used to take about a minute. In a 10 second period whose marker
  is missing, the slot itself is asked once.
- **How it finds the newest playlist.** It reads slots by their number, never Bee's feed lookup. The uploader writes a
  time marker for each stream every 10 seconds, at an address worked out from the clock, naming every quality's newest
  playlist (`src/shared/ladderMarker.ts`). At the start, at a switch, and when a quality stops or finishes, the player
  reads the marker of the previous 10 seconds, and the one before if that is missing, then one round of eight slots
  from where it says (`markerFinder.ts`). One marker read serves every quality for a few seconds, and a marker address
  found missing is never asked again (`ladderMarkerReads.ts`). The clock is the gateway's, taken from the `Date`
  header of every answer the Swarm client reads for the player and the stream list (`src/shared/gatewayClock.ts`), so
  a viewer whose clock is wrong still finds the marker. With no marker, it searches as before: at the start eight slots
  at once, spread out to the feed's length, closing in on the newest in a few rounds, and at a switch from the playing
  quality's newest slot, usually one round (`following/findNewestFromScratch.ts`, `findNewestFromHint.ts`). The new
  quality is read further back when the viewer is behind the live edge, at most ten reads, and the old one stops being
  read once hls.js has switched. When hls.js goes back to the old one before the new one plays, the new one stops
  instead. A switch asked before hls.js has reported its first quality is kept.
- **A quality that stops.** A quality is judged by its own progress, never by comparing it with another, because the
  qualities' feeds drift apart (`rungHealth.ts`). A switch is refused to a quality that has finished while the playing
  one is live, and to one still open whose newest segment sits more than 30 seconds behind the playing one's. When
  both have finished, as on a recording, no switch is refused, because every quality of a recording is complete
  whatever its dates say. When the playing quality has had nothing new for 8 seconds, or finishes, the next lower
  quality is found and then read for three of its segments, never under 6 seconds: if it moves on, the player moves to
  it and drops the stopped one. There is no limit on how many are dropped: a quality refused at a switch is dropped too,
  and the player keeps moving on until it is on a quality that moves. The last quality is never dropped. If the next
  one does not move on, the broadcast paused or ended, and the player says so.
- **The end.** The qualities of one broadcast finish moments apart, each as its upload drains. So when the playing
  quality finishes, the next lower one is watched for that whole bound rather than to its first new playlist: one that
  finishes inside them means the broadcast ended, and only one that carries on through them is moved to. A quality the
  player was moved to that finishes before hls.js has switched to it runs the same check.
- **A segment that will not load.** When hls.js gives up on one of the three newest segments of a live playlist
  (segments already marked as gaps not counted), the player marks that segment `#EXT-X-GAP` in the playlist it serves
  hls.js (`liveSegmentGaps.ts`). hls.js gives up after its own retries with no other quality left to try, or at once on
  a segment it finds no media in. The video skips that segment's picture, about one segment long, instead of freezing
  or restarting the player, and every later reload of that playlist says the same. At most four segments of one stream
  are skipped this way in any five minutes, and a stream opened after another starts with all four. Past that, or for
  an older segment, a finished broadcast or a recording, the player handles the error as it always did: hls.js's own
  skip stands for a segment it gave up on, and a fatal network error restarts the player (`mediaErrorRecovery.ts`). A
  restart resumes a finished recording at the viewer's place, one segment further on each time the same segment keeps
  failing, and rejoins a live stream at the live edge (`restartResume.ts`). While another quality is left, a segment
  that failed to load is tried there instead and nothing is marked. The playback quality panel counts each skipped
  segment once, under Segments Skipped, and not as a fatal error or a reconnect attempt.

## Diagnosing playback

`?qoe=1` on a watch page shows the playback quality panel, ported from the panel in the streaming monorepo's client
(`overlays/qoe/`). Its round button toggles it, and so does `Q` when you are not typing in a field. The panel lives in
the browser window, not in the player: drag the button to move it anywhere in the window, and drag any edge or corner
to resize it like a window, down to 160 by 120 px. Moving and resizing need a mouse, a finger or a pen. The keyboard
can focus the panel and scroll it, but moving or resizing it from the keyboard is not built yet. It opens 250 px wide
at the player's top right. It is always kept inside the window with its header, or its button when collapsed, in
reach, also after the window is resized and when full screen starts or ends. Where it was left, its size and whether it
was open are remembered in this browser under `stream-event-client:qoe-panel.v1`, and a place that no longer fits the
window is pulled back in.

It stays visible and usable in full screen: while the panel is on, the video's full screen button puts the whole player
in full screen rather than the video alone, so the panel can be inside it. This was checked in Chromium only. A browser
that refuses to move the full screen to the player keeps the video's own full screen, and the panel stays in the page,
where it may be hidden or not take clicks. Safari on an iPhone always plays full screen in its own player, so the panel
is not shown there. Copy puts what the panel shows on the clipboard as JSON, and Save downloads the same as
`qoe-<stream>-<date>-<time>.json`, which works where a page served over plain http is refused the clipboard. A value
not measured yet reads n/a, and a value out of range is marked with a `!` as well as its colour. The line under the
header names the viewer's build, the same label Copy diagnostics names. `?level=720p` pins one quality, which tells a
bad quality apart from a bad switch.

## How the player reads Swarm

hls.js expects playlists at fixed URLs. On Swarm every playlist update is new content under a feed, so the player brings
its own loaders (`CustomManifestLoader.ts`):

- **CustomManifestLoader** reads the latest playlist from its feed instead of a fixed URL. Every feed read the player
  makes goes through the Swarm client's player reader, which `AppProvider` hands the shared `ManifestFetcher` at start
  and on every source switch (`useSwarm`). Not found is a slot not written yet, and anything else is the gateway
  failing, backed off as before, a rate limit for at least as long as it asked.
- **CustomFragmentLoader** hands each segment to hls.js's own loader, staggered by a bounded random delay so a crowd at
  the live edge does not ask in the same instant (`src/shared/requestJitter.ts`). Segments, preview segments and
  stream pictures are loaded by hls.js and the browser from the URLs the client gives (`urlFor`), written into the
  playlist or the page, not read through the client. Each load's outcome is still reported to the client
  (`reportUrlLoad`): a segment hls.js loads or fails for the video, and a preview segment or a picture for the
  previews, so a source that serves feeds and fails every segment shows the failure bar. A failed one is asked again of
  the same source by hls.js. `fetchSegmentBytes` is the one place segment bytes are fetched, where a provider without
  URLs can plug in. It loads a segment from the source the video reads from at that moment. hls.js keeps the URLs it
  was given, for good in a recording, whose playlist is read only once, so the loader names each segment the player
  named again by the current source before it goes out (`ManifestFetcher.segmentUrlNow`), for a live stream as for a
  recording. A viewer who switches Video to another gateway or to their own Bee node therefore gets the next segment
  from the new source, and its load counts against that source. A URL the player did not name goes out as given: a
  preview's segment, and a recording published before 2026-08-13 whose manifest names its publisher's gateway.
- **ManifestStateManager** (`ManifestManagement.ts`) merges each live playlist into a growing EVENT playlist, so
  segments stay playable longer than the publisher's sliding window.
- **LadderFeedPoller** (`LadderFeedPoller.ts`) follows the feed of the quality hls.js plays, plus the one being
  switched to during a switch. A quality left behind forgets where it was, so coming back to it starts at its newest
  playlist. Where it starts comes from a `NewestIndexFinder` (`newestIndexFinder.ts`), injected so it can be swapped:
  the `MarkerFinder`, which reads the ladder's time marker (`src/shared/ladderMarker.ts`, copied from the uploader) and
  falls back to the `IndexSearchFinder`. How it follows is `followPredicted` in `following/`, the polling study's
  choice. The player assumes no segment length: the follower and the searches take it from the `#EXTINF` values of the
  playlist they stand on, and a join from a time marker takes the `segmentMs` the marker names, which is the stage's
  `HLS_FRAGMENT`. The study's simulator and the strategies it was compared with are in `test/feedModel/`.
- **A quality's first playlist** is waited for 20 s, the poller's 15 s search and 5 s more, and then that quality is
  failed so hls.js tries another, because a gateway that does not hold a quality never answers for it.
- **A slow source.** The `ManifestFetcher` times how long the source it reads from takes to answer that a slot is not
  there, over the latest 16 such answers (`sourceMissCost.ts`). Once five have been answered, the source is slow when
  the middle one of them is over 3 s. Before that it is slow only when at least two answers were all over 3 s, so one
  slow first answer on a cold connection does not make a fast gateway slow. A freshly started light Bee node with no
  blockchain took 6 to 10 s, where a full node takes 1.3 to 1.6 s. On a slow source a search round is taken to last
  one and a half of those answers. A read is given two rounds instead of the usual 10 s, and a quality's first playlist
  is waited for eight rounds and 5 s more instead of 20 s, both capped, at 30 s and at about two minutes. The player
  keeps reading from the source picked for it and never switches to another, and it makes no read more often than
  before. Until the first picture it says "This Swarm source answers slowly, so the video takes longer to start". On a
  source that is not slow nothing changes. On such a node the video can still stall after it starts: measured on
  2026-10-18, a segment took 2 to 5 s to load and hls.js gave one up at its own 10 s, and each switch of quality costs
  another search of about a minute. A failover to another quality cannot succeed there either, because the search of
  the quality tried keeps its fixed 15 s bound.

Feed URIs use a `swarm://<owner>/<topic>` scheme (`src/shared/masterPlaylist.ts`), because hls.js resolves every
playlist URI against the playlist's own URL and a URI with a scheme is the one case it leaves untouched.
