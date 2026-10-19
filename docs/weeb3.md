# The node in this browser (weeb-3)

weeb-3 (`@lat-murmeldjur/weeb_3` 0.0.354001) is a Swarm node compiled to WebAssembly that runs inside the viewer's tab.
The viewer uses it for two things: playing the video, when Use for picks it for Video, and sending chat messages on the
viewer's own stamp. Use for offers it for nothing else. The provider can still read the stream list, the previews and
the chat history, and the points below that describe those reads describe code no part reaches. In the page it is the source called Weeb3, and in
the code it is the provider kind `weeb-3` (`src/swarm/providers/weeb-3/`). A page runs one node, behind a shared
worker, and everything that uses weeb-3 shares it (`weeb3Runtime.ts`). It is ready once it has a peer and its service
worker controls the page, and counts as failed when it is not ready after 30 s (`WEEB3_START_DEADLINE_MS`).

- **Loaded only when picked.** The package is imported from one module, `weeb3Module.ts`, as a chunk of its own, so
  the first page load carries none of it. The build copies the package's browser files, its service worker, shared
  worker and WebAssembly module, to `/weeb-3/` (`scripts/weeb3-files.mjs`). The bundle carries no copy of the module
  of its own.
- **When it runs.** The node runs while something holds it: the video while weeb-3 is its source, the watch
  page's player while it shows, My Swarm from adding it until My Swarm closes, or a source's settings while it is
  checked there, and every read through it while that read runs. A read made while the node is starting waits for it
  to be ready, and one made while it is stopped starts it first, so a part never gets an early answer from a node that
  is not there yet. A node that fails to start answers the read as unavailable. Listing a saved one starts nothing.
  When the last of them lets go, as when every part moves to another source or the source is removed, the node is
  stopped and freed. The watch page's player lets go of the node and also stops weeb-3's player for its video, so a
  video the viewer has left loads nothing more through weeb-3.
- **Getting ready.** The page downloads the 2.2 MB WebAssembly module itself, reading it as it streams, so the row in
  My Swarm and the watch page can show how much has arrived against the length the server names. A download that has
  not finished after 60 s (`WEEB3_DOWNLOAD_DEADLINE_MS`), or whose package fails to load, is stopped and the node
  counts as failed. It hands the bytes to the package, then reports starting, then connecting with its peers counted
  against 200 (`WEEB3_HEALTHY_PEERS`), weeb-3's own connection target (`CONNECTION_BUILDUP_LIMIT` in its
  `src/accounting.rs`, which its project README says drops to four fifths for every 100 lost connections, down to 30).
  The node is ready at its first peer, so the video does not wait for the rest, and the count keeps building up after
  that.
- **A node that lost its peers.** Once ready, the node's peers are read every half second. When every read for 20 s
  finds no peers or throws, as after a phone locked the tab, the node is lost (`WEEB3_LOST_AFTER_MS`). A shorter dip,
  such as a network handover, leaves it ready. My Swarm's row says "Lost its peers", its settings say Test connection
  starts it again, and the line on the watch page adds "Open My Swarm to start it again." While it is lost, every read
  through it is unavailable at once, and a message pushed through it fails at once with "The Swarm node in this browser
  lost its peers. Open My Swarm to start it again." Nothing starts it again by itself and nothing switches to another
  source: Test connection in its settings, or Test again while adding it, starts a new node in its place, which is
  ready again at its first peer.
- **The video, in weeb-3's own player.** With weeb-3 as the video's source the watch page plays the stream with
  weeb-3's player (`src/features/player/OwnPlayerStage.tsx`, through the provider's `ownPlayer`), bare: a video element
  with the browser's controls, from the newest entry for a live stream and the beginning for a finished one, and none
  of this app's overlays or `?level=`. The quality menu weeb-3 adds beside its video is hidden, and its player, which
  starts held at the highest quality, is set to choose its quality itself once the stream is attached, as this app's
  own player does (`weeb3Provider.ts`). One quiet line under the player, never over the video, shows the download,
  then the peers out of 200 with the same note under 200, until the node is ready, and says so again if it loses its
  peers. The stream is attached once the node is ready. Nothing replaces weeb-3's player: one whose node fails, or that
  cannot attach, says "The Swarm node in this browser could not play this stream." and stays. weeb-3's limits are its
  own: it plays about 16 s behind live, does not leave a quality that stopped, does not notice a broadcast that
  returns, and plays one stream across the browser's tabs.
- **Leaving weeb-3's player stops it.** weeb-3 names no way to stop its player, which is hls.js underneath and would
  keep loading segments, up to three minutes ahead for a finished stream, for a video the viewer has left. So the build
  hands weeb-3's own import of hls.js the app's copy with its player class made stoppable (`weeb3Hls.ts` and
  `weeb3Playback.ts`, pointed at by `scripts/weeb3-files.mjs`), which records each player by the video it plays into. When the watch page stops showing
  weeb-3's player, because the video moves to another source, the viewer leaves the page or picks another stream, the
  player for that video is stopped and destroyed, and nothing weeb-3 calls on it afterwards loads again, nor does a new
  player weeb-3 makes for that video, until the page plays a stream into it again. The video itself is then paused and
  emptied, which stops the download in a browser that plays HLS natively, as Safari does without Media Source
  Extensions, where weeb-3 uses no hls.js and there is no player to stop. So both cases are covered: an hls.js player
  is stopped and destroyed, and a native one stops with its emptied video. The stoppable copy of hls.js is a small
  chunk of its own, loaded only by weeb-3's chunk, so the first page load still carries none of weeb-3. The dev
  server's dependency bundler leaves the package out, so the dev server makes the same switch.
- **No switching.** A part that reads from weeb-3 reads from it alone, as every part reads from its own source alone.
  None of its reads is handed to another source whatever it answers. Every read through it gets weeb-3's own 30 s
  budget rather than the client's 10 s (the provider's `shortestReadWindowMs`), so a missing chunk, which weeb-3 gives
  up on after about 17 s, ends as not found rather than cut short.
- **Reads.** weeb-3 reads through its service worker's routes: `/weeb-3/chunks/` for a chunk, a feed entry or a
  single-owner chunk, `/weeb-3/bytes/` for bytes, and segment URLs on its caching route `/weeb-3/hls/bytes/`
  (`weeb3Provider.ts`). weeb-3 puts a chunk's 8-byte span before bytes and before a single-owner chunk's payload,
  which Bee leaves out, so it is taken off. A feed entry or a single-owner chunk whose body is longer than one chunk's
  4 KB, such as a stream list of more than a few dozen streams, wraps the root of a tree of chunks, and weeb-3 answers
  it with the root's own payload, the addresses of the chunks below it, where Bee joins the body. So when the span says
  the body is longer than the payload, the body is read whole from `/weeb-3/bytes/` at the root's address, and a body
  that is not the length the span names answers unavailable. A body uploaded with erasure coding keeps its redundancy
  level in the top byte of its root's span, as 0x80 plus the level, so a span whose top byte is above 0x80 names the
  length in its lower 7 bytes (`src/swarm/chunkSpan.ts`, as Bee's own `redundancy.DecodeSpan` reads it). The root's
  address is still made over the span as stored. Read whole, such a span names a body of about 9.3e18 bytes, which no
  joined body matches. The chat's slots, read through Weeb3 or through a gateway, take their length the same way.

  A feed's head, which weeb-3 has no lookup for, is found by reading the feed's entries by index, eight at a time
  (`newestEntrySearch.ts`): entry 0 and every power of four less one, then wider steps past the newest entry found
  until one misses, then even cuts of the gap until the newest entry and the missing one above it touch. A miss costs
  weeb-3 about 17 s, so a head read takes a few of those, about a minute for a feed of a few hundred entries, and the
  answer it gives is always an entry read with the one above it read missing. A later head read of the same feed starts
  from the head found before, reading it and the five entries above it at once, so a polled chat, stream list or own
  feed that gained up to four entries costs one round. When the head found before is missing, the head went back below
  it, and the search starts again from scratch rather than keep the old one.

  A single-owner chunk comes back as the chunk it wraps, without the identifier and signature that prove it the
  owner's, so a read of one by its address answers unsupported, and plainly. The chat reads its slots, its notes and a
  sender's own copies by the owner and the identifier instead (`readUnsignedSoc`), and takes weeb-3's word for whose
  chunk it is (`src/features/chat/ownersChunk.ts`). Every message is still checked against its sender's signature, so
  such a chunk can at most carry a message somebody signed, never one in another's name.

- **Stream pictures.** With weeb-3 as the source of Previews, a stream card's picture loads from weeb-3's route
  `/weeb-3/bzz/<reference>/`, which only its service worker answers. Until the node is ready that worker may not
  control the page, and the browser would ask the site itself, which never serves a picture there. So a card is given
  the picture's address only once the node is ready, and shows its loading indicator until then, whether Weeb3 was
  picked before the page loaded or switched to while the pictures showed from a gateway. My Swarm has no way to stop
  the node while a part reads from it, so a stopped node is only the moment before the client starts it, and the card
  waits through that as it waits through the start. An announced stream's watch page draws its picture behind the
  countdown the same way, once the node is ready. A picture already drawn stays while the node is lost. A node that
  fails to start gives no picture, and the card shows what it shows for a stream with none, and no other source is
  asked. A picture that failed to load counts against the address it failed at, so switching Previews to another
  source asks that source for it again.
- **Stopping, as far as it goes.** Stopping frees the page's handle on the node, and with 0.0.354001 that leaves the
  node in the package's shared worker running: a handle made after a stop still finds its peers. The package names no
  way to stop that worker's node, so it lasts until the browser closes the worker with the tab. Its player in the page
  is another matter: the app stops that one itself when the viewer leaves it, as "Leaving weeb-3's player stops it"
  above says.
- **Sending through it.** A chat message on the viewer's own stamp is pushed with weeb-3's `postPushChunk`
  (`weeb3Push.ts`), with a deadline of a minute, as [who pays for a message](own-stamp.md) says.
- **The live proof.** `pnpm proof:weeb3` builds the app and, on the public Swarm network, adds the node in a real
  browser, picks it for the video, waits for it to be ready, plays a finished stream from its beginning, checks that
  `/weeb-3/bytes/` carries exactly the 8-byte span `/weeb-3/hls/bytes/` leaves out, and asks the shared worker for its
  peers after the stop (`e2e/weeb3Live.proof.ts`). It prints what it saw and is never part of `pnpm e2e`. Its default
  stream is a public test stream run by the weeb-3 project, and `WEEB3_PROOF_OWNER` and `WEEB3_PROOF_TOPIC` name
  another.

What the page's policy allows weeb-3, WebAssembly and secure websockets to any host, is in
[the image](image.md#what-the-page-may-reach).
