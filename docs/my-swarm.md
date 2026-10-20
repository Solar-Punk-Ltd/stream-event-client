# My Swarm

My Swarm is the panel where a viewer says who they are in the chat and which Swarm sources the page reads from. This
page says what the panel holds, how a source is added and checked, and what the browser keeps of it. A developer
changing a source type or a check starts here.

The Swarm access list, Use for and Sign in with Swarm ID are experimental, offered beside the defaults. The
[README](../README.md#experimental-your-own-way-into-swarm-and-swarm-id) says what they are for. A deployment with
[`experimental` false](configuration.md#the-experimental-switch) turns them off, and My Swarm then holds only the ID.

The button at the right of the header opens My Swarm (`src/features/connect/Connect.tsx`), a panel at the side of the
window on a wider screen. The button says My Swarm, or the viewer's chat name with its badge once they chat. My Swarm
holds who the viewer is in the chat, every source they can read Swarm through, and what each source is used for.

- Adding a source and a source's settings open in its place, with a back arrow. Escape goes back one view the same
  way, and only Escape on the menu closes My Swarm.
- Each new view takes focus to its first field where it has one, as the address of a gateway or a Bee node, and to
  its title otherwise.
- Closing My Swarm while Weeb3 is being added asks first, since closing stops that node, with Keep adding and Stop and
  close.
- Every change applies at once and is kept in the browser, and nothing switches a source by itself.

## The sections

- **ID** (`IdSection.tsx`). On a site with chat.
  - Not chatting: a guest name with Chat as guest, the button as tall as the field, and under it "For the smoothest
    experience, go with the defaults and a simple name." Below a rule, a short beta note says the settings that
    follow, Sign in with Swarm ID and the sources, are an experiment the viewer can help test, and asks for feedback in
    the chat. Then Sign in with Swarm ID where the deployment offers it, as [the chat](chat.md) and
    [Swarm ID](swarm-id.md) describe.
  - Chatting: the name with its badge and Leave for a guest, or the Swarm ID account with Sign out, and the theme
    switcher where the deployment allows it (`ThemeOptions.tsx`). Leave asks first, since it forgets the name.
  - The chat's own join button opens My Swarm too.
- **Chat stamp** (`ChatStampSection.tsx`). Once the viewer is chatting: Gateway pays or My stamp, as
  [who pays for a message](own-stamp.md) says.
- **Swarm access** (`SwarmAccess.tsx`). One list of every source: the gateways `config.json` offers, marked Offered,
  then the ones the viewer added. Each row has a status dot, the name, its type and address, how long its last light
  check took, and a Settings button.
  - While My Swarm is open each source gets that light check about every 10 s (`src/features/gateway/sourceStatus.ts`,
    `useSourceStatuses.ts`): the stream list's first entry for a gateway, and Bee's `/health`, `/readiness` and
    `/peers` for a Bee node. Nothing is checked while it is closed.
  - A gateway that refuses `/soc` is asked it once while My Swarm stays open, and its later checks read the entry by
    its chunk address.
  - Add source sits under the list.
- **Use for** (`UseFor.tsx`). All features reads the video, the stream list, the previews and the chat history from the
  one source picked. Per feature picks a source each for Video, Stream list, Previews and Chat history.
  - Weeb3 is offered for Video alone (`servesPart` in `src/swarm/routing.ts`), so All features does not offer it.
    While the list holds it, a line under the selects says "Weeb3 is used for the video, and to send chat messages on
    your own stamp." A part saved on Weeb3 other than the video, or All features saved on it, reads from the
    deployment's default source.
  - While the event pays, chat messages are sent to `chat.writeUrl`, whichever source reads the chat history. On the
    viewer's own stamp they go through a Bee node of their own or Weeb3, the one picked for Chat history when it is a
    Bee node, as [who pays for a message](own-stamp.md) says.
  - The deployment's default gateway reads its chat history at `chat.readUrl`, where it serves the chat's paths, and
    any other source reads the chat at its own address.
  - A part saved on a source the deployment no longer offers is read from the deployment's default source when the
    page loads, and so is one saved on a source the viewer removed (`resolveRouting` in `src/swarm/routing.ts`).

## Adding a source

Three tiles (`AddSourceViews.tsx`): Gateway, a Swarm gateway at an https address, My Bee node, on this computer or at
an https address, and Weeb3, a Swarm node in this browser tab. A browser has one Bee node of its own and one Weeb3, so
each tile says Already added once it is. A gateway or a Bee node takes an address and a name, and Test connection runs
its checks (below). The add button stays disabled until every check passed for the address in the field, so nothing is
added before, and a new address asks for the checks again. A source that was added is not put in use: the viewer picks
it under Use for.

**Weeb3.** Opening its tile starts the node and shows its download, against the 2.2 MB module, and its peers out of
200, the healthy target, with "Playback can start before that."

- Its checks run at once, and Add Weeb3 waits for them. Its reads are checked from its first peer, so it can be added
  without waiting for more. When they did not pass, Test again runs them once more, and starts the node again first if
  it failed.
- Use for offers it for Video alone, and the video then reads through it and through nothing else.
- Its row shows how far the node has got: the download, then "Starting", "Connecting, N of 200 peers", and once ready
  "N of 200 peers", or "Failed to start".

Everything else about it is in [the node in this browser](weeb3.md).

## The checks

Each type of source runs its own, in this order, each line with ✓, ✕ or – and its time. The first that fails stops
the rest, which show –, and a box under them says what is wrong and what to fix, such as "Not added. It does not allow
this site (CORS)." and "Its operator has to add this site to Bee's cors-allowed-origins." For a Bee node of the
viewer's own that box also gives the exact `cors-allowed-origins` lines for this page's origin, or how to undo a refusal
of the browser's local network question (`src/features/gateway/sourceChecks.ts`, its words in `checkWords.ts`).

| Check                                            | Type         | How it is measured                                                                                                       |
| ------------------------------------------------ | ------------ | ------------------------------------------------------------------------------------------------------------------------ |
| Answers over https                               | gateway      | The address is https, or on this computer, and the stream list's first entry is asked. Any answer is one                 |
| Answers, on this computer or at an https address | Bee node     | The address is on this computer or https, then the same read                                                             |
| Allows this site (CORS)                          | gateway, Bee | That answer could be read by this page. A refusal is told from nothing there by a second request without CORS            |
| Bee 2.6 or later                                 | gateway      | `/health`'s version. A gateway that does not state one passes with "not stated", one that states an older release fails  |
| Bee 2.6 or later, ready                          | Bee node     | `/health`'s version, `/readiness` and `/peers`, so a node still starting or with no peers fails                          |
| Node started                                     | Weeb3        | Its module downloaded and the node running, waited for as long as its own deadlines allow                                |
| Connected to a peer                              | Weeb3        | Its first peer, waited for up to a minute                                                                                |
| Reads a chunk                                    | every type   | The root chunk of a segment of this event's video, read the way the chat history reads its slots, through its chat route |
| Reads bytes                                      | every type   | The same segment's bytes, read the way the player reads it                                                               |
| Reads this event's stream list                   | every type   | The feed's head, parsed as a stream list, then its entry by index, as the player reads a playlist. Weeb3 below           |

The segment comes from the stream list the page shows, a live stream first, else the newest with video, and its
playlist is found as the player finds it (`src/features/gateway/eventContent.ts`). A stream's picture stands in where
no stream has video yet.

The stream list check reads the feed's head and then the entry the head names, by its index. That second read is the
one the player opens every playlist with, so a gateway that serves feed heads and no feed entry, by `/soc` or by chunk
address, fails this check.

Weeb3 has no feed lookup, and a head search through it costs a few misses of about 17 s each. So its stream list check
reads the newest entry the page already read, by that entry's index, one read of the same body the browse page reads.
It searches for the head only when the page has not read the list, or when that entry is not on the node yet, as right
after a gateway ahead of it served a new list.

## A source's settings

Its name and address, Test connection, which runs the same checks again, and the last light check's time until then
(`SourceSettings.tsx`). A source the event offers says "Offered by this event. It cannot be changed or removed." and its
fields are read only. An added source's name can be changed, its address cannot, and Remove takes it out, every part
that read from it moving to the default gateway. Weeb3's settings show its peers, its network and the weeb-3 build, and
its Test connection starts a node that failed once more. Copy diagnostics is there for every source.

- **No fallback.** A part reads from the source picked for it and from nothing else, whatever that source answers. The
  player's own retries ask the same source again. A switch under Use for takes effect at once, so the video's next
  segment comes from the new source, in a recording as in a live stream.
- **A source that fails.** When a part's reads, or the segments and pictures loaded for it, have had no answer it can
  use for 10 s, a bar under the header says so (`FailureBars.tsx`), such as "Video cannot load from Event gateway." and
  "No answer for more than 10 s.", with a Choose another source button that opens My Swarm while `experimental` is on.
  One bar per failing part, gone at the part's next answer, or 30 s after it stopped reading. A not found is an answer,
  so a chat slot not written yet never shows one. The watch page names the video's source above the player, such as "via
  Event gateway".
- **Copy diagnostics.** The last checks of that source, who answered each part in the last minute, the build and the
  browser (`src/features/gateway/report.ts`). The build is named by its release tag and short commit, such as
  `v1.7.0-rc.5 (1fcfbd4)`, as [the image](image.md#the-release-tag-and-the-build-label) says. It holds no address but
  the checked source's.

## What the browser keeps

In `localStorage`, every read and write guarded (`src/app/browserStorage.ts`) so a refusal leaves the deployment's
defaults for that visit:

| Key                                        | What it holds                                                                                                | Written by                                            |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------- |
| `swarm-sources`                            | The sources the viewer added: id, type (`gateway`, `bee-node` or `weeb-3`), name, address, none for `weeb-3` | `src/app/sourceStorage.ts`                            |
| `swarm-routing`                            | All features or per feature, the source picked, and each part's source                                       | `src/app/sourceStorage.ts`                            |
| `viewer-theme`                             | The theme a viewer picked with the theme switcher, kept after a logout                                       | `src/app/themeChoice.ts`                              |
| `stream-event-client:chat-session`         | A guest's chat login: the display name, the chat key this browser made for them, and its address             | `src/features/chat/auth/persistence.ts`               |
| `stream-event-client:chat-stamp:<address>` | Per account, by its chat address on this site: whether the gateway or their own stamp pays                   | `src/features/chat/stamp/chatStampChoice.ts`          |
| `stream-event-client:qoe-panel.v1`         | Where the playback quality panel (`?qoe=1`) sits, its size, and whether it is open                           | `src/features/player/overlays/qoe/qoePanelStorage.ts` |
| `stream-event-client:own-player-quality`   | The Weeb3 player's quality: `by-peers`, or the height held, such as `720`                                    | `src/features/player/qualityChoice.ts`                |

The Swarm ID sign-in is not among these. The Swarm ID library keeps what it needs for it, which this list does not
cover. Only viewer-added sources are stored: the offered gateways come from `config.json` on every load. With
`experimental` false the page neither reads nor writes `swarm-sources` and `swarm-routing`, and leaves them as they
were.
