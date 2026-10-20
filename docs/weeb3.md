# The node in this browser (weeb-3)

weeb-3 (`@lat-murmeldjur/weeb_3` 0.0.354001) is a Swarm node compiled to WebAssembly that runs inside the viewer's tab,
so the page can read Swarm without any gateway. This page says what the viewer does with it, how the node is started
and stopped, and how its player and its reads differ from a Bee node's.

The viewer uses it for two things: playing the video, when Use for picks it for Video, and sending chat messages on
the viewer's own stamp. Use for offers it for nothing else. In the page it is the source called Weeb3, and in the code
it is the provider kind `weeb-3` (`src/swarm/providers/weeb-3/`). A page runs one node, behind a shared worker, and
everything that uses weeb-3 shares it (`weeb3Runtime.ts`). It is ready once it has a peer and its service worker
controls the page, and counts as failed when it is not ready after 30 s (`WEEB3_START_DEADLINE_MS`).

## The node

- **Loaded only when picked.** The package is imported from one module, `weeb3Module.ts`, as a chunk of its own, so
  the first page load carries none of it. The build copies the package's browser files, its service worker, shared
  worker and WebAssembly module, to `/weeb-3/` (`scripts/weeb3-files.mjs`). The bundle carries no copy of the module
  of its own.
- **When it runs.** The node runs while something holds it: the video while weeb-3 is its source, the watch page's
  player while it shows, My Swarm from adding it until My Swarm closes, or a source's settings while it is checked
  there, and every read through it while that read runs.
  - A read made while the node is starting waits for it to be ready, and one made while it is stopped starts it
    first, so a part never gets an early answer from a node that is not there yet. A node that fails to start answers
    the read as unavailable. Listing a saved one starts nothing.
  - When the last of them lets go, as when every part moves to another source or the source is removed, the node is
    stopped and freed. The watch page's player lets go of the node and also stops weeb-3's player for its video, so a
    video the viewer has left loads nothing more through weeb-3.
- **Getting ready.** The page downloads the 2.2 MB WebAssembly module itself, reading it as it streams, so the row in
  My Swarm and the watch page can show how much has arrived against the length the server names.
  - A download that has not finished after 60 s (`WEEB3_DOWNLOAD_DEADLINE_MS`), or whose package fails to load, is
    stopped and the node counts as failed.
  - It hands the bytes to the package, then reports starting, then connecting with its peers counted against 200
    (`WEEB3_HEALTHY_PEERS`), weeb-3's own connection target (`CONNECTION_BUILDUP_LIMIT` in its `src/accounting.rs`,
    which its project README says drops to four fifths for every 100 lost connections, down to 30).
  - The node is ready at its first peer, so the video does not wait for the rest, and the count keeps building up
    after that.
- **A node that lost its peers.** Once ready, the node's peers are read every half second. When every read for 20 s
  finds no peers or throws, as after a phone locked the tab, the node is lost (`WEEB3_LOST_AFTER_MS`). A shorter dip,
  such as a network handover, leaves it ready.
  - My Swarm's row says "Lost its peers", its settings say Test connection starts it again, and the line on the watch
    page adds "Open My Swarm to start it again."
  - While it is lost, every read through it is unavailable at once, and a message pushed through it fails at once
    with "The Swarm node in this browser lost its peers. Open My Swarm to start it again."
  - Nothing starts it again by itself and nothing switches to another source: Test connection in its settings, or
    Test again while adding it, starts a new node in its place, which is ready again at its first peer.
- **Stopping, as far as it goes.** Stopping frees the page's handle on the node, and with 0.0.354001 that leaves the
  node in the package's shared worker running: a handle made after a stop still finds its peers. The package names no
  way to stop that worker's node, so it lasts until the browser closes the worker with the tab. Its player in the page
  is another matter: the app stops that one itself when the viewer leaves it, as the next section says.

## The video, in weeb-3's own player

With weeb-3 as the video's source the watch page plays the stream with weeb-3's player
(`src/features/player/OwnPlayerStage.tsx`, through the provider's `ownPlayer`), bare: a video element with the
browser's controls, from the newest entry for a live stream and the beginning for a finished one, and none of this
app's overlays or `?level=`.

- One quiet line under the player, never over the video, shows the download, then the peers out of 200 with the same
  note under 200, until the node is ready, and says so again if it loses its peers. The stream is attached once the
  node is ready.
- Nothing replaces weeb-3's player: one whose node fails, or that cannot attach, says "The Swarm node in this browser
  could not play this stream." and stays.
- weeb-3's limits are its own: it plays about 16 s behind live, does not leave a quality that stopped, does not notice
  a broadcast that returns, and plays one stream across the browser's tabs.
- **Its quality.** weeb-3 adds a quality menu of its own beside the video, and the page hides it (`OwnPlayerStage.scss`).
  In its place, while the video plays, a line under it says the node's peers and the height playing, such as
  "88 peers · 720p", with a Quality picker beside it: By peers, then each height the stream has, highest first
  (`OwnPlayerStage.tsx`, `useOwnPlayerQuality.ts`). It shows once the stream's qualities have loaded, which weeb-3's
  `streamQuality` reports.
  - By peers is the rule from weeb-3's own HLS example page (`qualityByPeers.ts`): the highest from 90 peers, and one
    height lower below each of 90, 60 and 30, never below the lowest the stream has. It applies as soon as a quality
    plays, then looks at the peer count again every 5 s while the video plays, and switches through weeb-3's
    `setStreamQuality` only when another height is due and no earlier switch is still taking effect. By peers waits
    while the video is paused.
  - A height picked is held whatever the peers, and a stream without it plays the nearest lower one, which the picker
    then shows. A switch weeb-3 refuses, as during a seek back, is tried again a second later.
  - The pick is kept in this browser under `stream-event-client:own-player-quality`, so the next stream starts at it,
    and By peers is where a viewer starts who never picked.
  - The picker changes the quality inside weeb-3 and nothing else: no read and no part moves to another source.
- **Leaving weeb-3's player stops it.** weeb-3 names no way to stop its player, which is hls.js underneath and would
  keep loading segments, up to three minutes ahead for a finished stream, for a video the viewer has left.
  - So the build hands weeb-3's own import of hls.js the app's copy with its player class made stoppable
    (`weeb3Hls.ts` and `weeb3Playback.ts`, pointed at by `scripts/weeb3-files.mjs`), which records each player by the
    video it plays into.
  - When the watch page stops showing weeb-3's player, because the video moves to another source, the viewer leaves
    the page or picks another stream, the player for that video is stopped and destroyed. Nothing weeb-3 calls on it
    afterwards loads again, nor does a new player weeb-3 makes for that video, until the page plays a stream into it
    again.
  - The video itself is then paused and emptied, which stops the download in a browser that plays HLS natively, as
    Safari does without Media Source Extensions, where weeb-3 uses no hls.js and there is no player to stop. So both
    cases are covered: an hls.js player is stopped and destroyed, and a native one stops with its emptied video.
  - The stoppable copy of hls.js is a small chunk of its own, loaded only by weeb-3's chunk, so the first page load
    still carries none of weeb-3. The dev server's dependency bundler leaves the package out, so the dev server makes
    the same switch.

## Sending through it

A chat message on the viewer's own stamp is pushed with weeb-3's `postPushChunk` (`weeb3Push.ts`), with a deadline of
a minute, as [who pays for a message](own-stamp.md) says.

## Reads the provider also supports

The provider implements every read the Swarm client asks for, so it could serve the stream list, the previews and the
chat history too. No part is routed to Weeb3 for these today: Use for offers it for Video alone. What follows is how
those reads work, for a developer who changes that.

- **No switching.** A part that reads from weeb-3 reads from it alone, as every part reads from its own source alone.
  Every read through it gets weeb-3's own 30 s budget rather than the client's 10 s (the provider's
  `shortestReadWindowMs`), so a missing chunk, which weeb-3 gives up on after about 17 s, ends as not found rather than
  cut short.
- **Routes.** weeb-3 reads through its service worker's routes: `/weeb-3/chunks/` for a chunk, a feed entry or a
  single-owner chunk, `/weeb-3/bytes/` for bytes, segment URLs on its caching route `/weeb-3/hls/bytes/`, and a
  picture at `/weeb-3/bzz/<reference>/` (`weeb3Provider.ts`).
- **Spans.** weeb-3 puts a chunk's 8-byte span before bytes and before a single-owner chunk's payload, which Bee leaves
  out, so it is taken off. A body longer than one chunk's 4 KB is read whole from `/weeb-3/bytes/` at the root's
  address when the span says so, and a body that is not the length the span names answers unavailable. A span whose
  top byte is above 0x80 carries an erasure coding level there and names the length in its lower 7 bytes
  (`src/swarm/chunkSpan.ts`, as Bee's own `redundancy.DecodeSpan` reads it).
- **A feed's head.** weeb-3 has no feed lookup, so the head is found by reading entries by index, eight at a time
  (`newestEntrySearch.ts`): entry 0 and every power of four less one, then wider steps past the newest entry found, then
  even cuts of the gap. A miss costs about 17 s, so a first head read takes a few of those. A later read of the same
  feed starts from the head found before and reads it with the five entries above it at once.
- **Single-owner chunks.** weeb-3 serves one as the chunk it wraps, without the identifier and signature that prove it
  the owner's, so a read of one by its address answers unsupported. The chat reads its slots, its notes and a sender's
  own copies by the owner and the identifier instead (`readUnsignedSoc`) and takes weeb-3's word for whose chunk it is
  (`src/features/chat/ownersChunk.ts`). Every message is still checked against its sender's signature.
- **Stream pictures.** A card is given a picture's `/weeb-3/bzz/` address only once the node is ready, because until
  then the service worker may not control the page and the site itself never serves a picture there. A node that fails
  to start gives no picture, and no other source is asked.

## The live proof

`pnpm proof:weeb3` (`e2e/weeb3Live.proof.ts`) adds the node in a real browser on the public Swarm network, plays a
finished stream through it and checks its reads and its stop. It prints what it saw and is never part of `pnpm e2e`.
`WEEB3_PROOF_OWNER` and `WEEB3_PROOF_TOPIC` name another stream than its default.

What the page's policy allows weeb-3, WebAssembly and secure websockets to any host, is in
[the image](image.md#what-the-page-may-reach).
