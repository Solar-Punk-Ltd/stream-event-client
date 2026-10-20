# The whole stack

This viewer is one piece of a larger system, all of it open source. The stack, in
[streaming-monorepo](https://github.com/Solar-Punk-Ltd/streaming-monorepo), puts the streams on Swarm. A few libraries
and services run the chat and hold the viewer's identity. This page names each piece and its repository, then follows
a live stream and a chat message from start to finish. A [glossary](#words-used-across-these-docs) of the Swarm words
used across these docs closes the page.

## The pieces and their repositories

| Piece               | Repository                                                                                                         | What it is                                                                                                                                         | How this viewer meets it                                                                           |
| ------------------- | ------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| The viewer          | [Solar-Punk-Ltd/stream-event-client](https://github.com/Solar-Punk-Ltd/stream-event-client)                        | This repository: the stream list, the player, the chat and My Swarm, as a static page                                                              | It is the viewer                                                                                   |
| The stack           | [Solar-Punk-Ltd/streaming-monorepo](https://github.com/Solar-Punk-Ltd/streaming-monorepo), `apps/hls-stream`       | Takes a broadcast in, cuts it into HLS segments, and writes the segments and each quality's playlist feed to Swarm (`packages/stream-uploader`)    | The player reads the playlists and segments it wrote                                               |
| The admin           | streaming-monorepo, `apps/web2-admin`                                                                              | The console where an event's streams are declared and published. It signs the stream list feed, also called the catalogue                          | The browse page reads that stream list                                                             |
| The manager         | streaming-monorepo, `apps/infra-manager`                                                                           | The console that deploys and funds streaming stages                                                                                                | This viewer does not use it                                                                        |
| The ingest server   | [Solar-Punk-Ltd/swarm-srs](https://github.com/Solar-Punk-Ltd/swarm-srs)                                            | A fork of the SRS media server. It takes SRT or RTMP from the broadcaster, cuts HLS and tells the uploader about each segment                      | This viewer does not talk to it. It plays the segments the uploader wrote from its output          |
| The chat library    | [Solar-Punk-Ltd/swarm-chat-js](https://github.com/Solar-Punk-Ltd/swarm-chat-js), npm `@solarpunkltd/swarm-chat-js` | Signs and sends chat messages, and reads a chat back                                                                                               | The chat runs on it ([the chat](../chat.md))                                                       |
| The chat aggregator | [Solar-Punk-Ltd/swarm-chat-aggregator-js](https://github.com/Solar-Punk-Ltd/swarm-chat-aggregator-js)              | The chat server. It listens for new messages, checks each one, and publishes it to the stream's chat feed                                          | The chat reads the feed it writes                                                                  |
| Swarm ID            | [Solar-Punk-Ltd/solarpunk-id](https://github.com/Solar-Punk-Ltd/solarpunk-id), npm `@solarpunkltd/swarm-id`        | A separate experimental project, Solar Punk's fork of swarm-id: a site that holds a person's accounts, and the library apps use to sign in with it | Sign in with Swarm ID and My stamp ([Swarm ID](../swarm-id.md))                                    |
| weeb-3              | [lat-murmeldjur/weeb-3](https://github.com/lat-murmeldjur/weeb-3), npm `@lat-murmeldjur/weeb_3`                    | A whole Swarm node compiled to WebAssembly that runs inside a browser tab                                                                          | Weeb3 in My Swarm, for the video and for sending on the viewer's own stamp ([weeb-3](../weeb3.md)) |
| Bee                 | [ethersphere/bee](https://github.com/ethersphere/bee)                                                              | The Swarm node every other piece talks to                                                                                                          | Every gateway and Bee node the viewer reads from is one                                            |

The monorepo explains its side in its
[architecture overview](https://github.com/Solar-Punk-Ltd/streaming-monorepo/blob/main/docs/architecture/overview.md),
the [stack's README](https://github.com/Solar-Punk-Ltd/streaming-monorepo/blob/main/apps/hls-stream/README.md) and
[self-hosting](https://github.com/Solar-Punk-Ltd/streaming-monorepo/blob/main/docs/self-hosting.md), for running a
stack of your own.

The viewer imports no package from the monorepo and pins no version of it. What ties the two together is the formats it
reads: the stream list, the playlist feeds and the ladder markers. The viewer keeps its own copies of that code in
`src/shared/`, so a change to any of those formats in the monorepo has to land there too.

## A live stream, from the broadcaster to the screen

```mermaid
flowchart LR
  obs[Broadcaster: OBS or similar] -->|SRT or RTMP| srs[Ingest server: swarm-srs]
  srs -->|segments and webhooks| uploader[stream-uploader]
  uploader -->|segments, a playlist feed per quality| bee[Bee nodes]
  uploader -->|live, then ended| admin[Admin: web2-admin]
  admin -->|signed stream list feed| bee
  bee --> gateway[Event gateway]
  gateway --> viewer[This viewer]
```

1. **The stream is declared.** Someone creates the stream in the admin and publishes it. The stack refuses a
   broadcast for a stream that was not published.
2. **The broadcast comes in.** The broadcaster sends SRT or RTMP to the ingest server, which cuts the video into HLS
   segments, a few seconds each, at several qualities. That set of qualities is the ladder.
3. **The segments go to Swarm.** The stream uploader stores each segment on Swarm through a Bee node. After each one it
   updates that quality's playlist, which lives at a feed of its own. It also writes markers, small entries the viewer
   uses to find the newest playlist without searching for it. When the broadcast ends, each playlist is closed as a
   recording.
4. **The stream list says it is live.** The uploader tells the admin the stream is live, and later that it ended. The
   admin then writes the event's stream list feed and signs it with the event's key.
5. **The viewer plays it.** The browse page reads the stream list once a minute. The watch page reads the playlist
   feed of the one quality it plays and loads the segments it names, from the source My Swarm picked, by default the
   event gateway ([the player](../player.md)).

## A chat message, from sending to every reader's screen

```mermaid
flowchart LR
  sender[Sender's page, swarm-chat-js] -->|signed message, GSOC write| write[Chat write endpoint: Bee, stamps it]
  write -->|Swarm| listen[Aggregator's Bee node]
  listen --> agg[Chat aggregator]
  agg -->|chat feed, history files, slot notes| swarm[Swarm]
  swarm --> read[Chat read endpoint: Bee]
  read --> readers[Every reader's page]
```

1. **The message is signed.** The sender's page signs it with their chat key: a key this browser made for a guest, or
   the key Swarm ID gives this site for a signed-in person, with the binding that proves it is theirs.
2. **It is written to the shared inbox.** Every chat of the event writes to one shared address, a GSOC (a chunk anyone
   may write to, see the [glossary](#words-used-across-these-docs)). While the event pays, the page writes it through
   the chat write endpoint, a Bee node that stamps it. On the viewer's own stamp, Swarm ID stamps it and the page sends
   it through the viewer's Bee node or weeb-3 ([who pays](../own-stamp.md)). If the message is not seen back in the
   chat, the page writes it again every 10 s, up to five times, then offers Retry.
3. **The aggregator picks it up.** Its own Bee node hears every new write to the inbox. The write endpoint must be a
   different Bee node, because Bee hands a write on to a listener only when it came from another node. The aggregator
   checks the message's size, shape, signature, binding, clock and rate, drops a copy it already has, and publishes it
   as the next entry of the stream's chat feed, `chat-<stream topic>` under the aggregator's own key.
4. **Readers see it.** Each reader's page reads the chat through the chat read endpoint. Beside each entry, the
   aggregator saves a history file and writes short notes per time slot saying which entries landed, so a reader asks
   only for entries that exist ([the chat](../chat.md)).

## Words used across these docs

- **Bee**: the program that runs a Swarm node.
- **Gateway**: a Bee node others can read through over HTTPS. The event runs its own, the event gateway.
- **Chunk**: the unit Swarm stores, up to 4 KB. A segment or a file is a tree of chunks, named by the address of its
  root.
- **Postage stamp, batch**: what pays for storing chunks. A batch is bought once and stamps chunks until it is full or
  runs out of time. The viewer never holds one.
- **Feed**: an address that always points at the newest version of something, made from an owner, the key that signs
  it, and a topic, a name. Its entries are numbered, so an older entry can be read by its index. The stream list, each
  playlist and each chat are feeds.
- **Slot**: the numbered position of an entry in a feed. The stream list is read by slot, and a chat's slot notes say
  which slots hold a message.
- **Catalogue**: another name for the stream list feed, used by the streaming-monorepo. The code spells it `catalog`,
  as in `catalog.owner` and `catalog.topic` in `config.json`.
- **Single-owner chunk (SOC)**: a chunk only its owner's key can write. A feed entry is one.
- **GSOC**: a single-owner chunk whose key is shared on purpose, so anyone can write to it and a listener hears each
  write. The chat inbox is one, which is why its key in `config.json` is not a secret ([the chat](../chat.md)).
- **HLS, segment**: HLS is video cut into short segments listed by a playlist. A segment is a few seconds of video.
- **Ladder, rung**: the ladder is the set of qualities a stream is cut at, and a rung is one of them.
- **Master playlist**: the playlist that lists every rung. When the stream list names the rungs, the viewer builds it
  itself.
- **Marker, slot note**: small entries the writers add so a reader can find the newest entry of a feed by its number
  instead of searching. The uploader writes markers for playlists, the aggregator writes slot notes for the chat.
- **Part**: one of the four things the page reads from Swarm: the video (`player`), the stream list (`stream-list`),
  the previews (`previews`) and the chat history (`chat`). Each part reads from one source.
- **Source**: one way of reaching Swarm that a viewer may pick in My Swarm: a gateway, a Bee node of their own, or
  Weeb3.
- **Use for**: the setting in My Swarm that picks a source per part, either one source for all features or one per
  feature.
- **Swarm ID binding**: a person's signed statement that a chat key on one site belongs to their account.
- **weeb-3, Weeb3**: the Swarm node in the browser tab. The package is weeb-3, and My Swarm calls the source Weeb3.
