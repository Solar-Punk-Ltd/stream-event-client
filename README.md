# stream-event-client

A lightweight web app for watching the Devcon 8 streams over [Swarm](https://www.ethswarm.org):
browse the event's streams, watch one, choose and test where each part loads from (the event gateway,
another gateway, your own Bee node, or Weeb3, a Swarm node that runs in the browser tab), and chat with the other
people watching, as a guest with a display name or signed in with Swarm ID, with the event gateway paying for each
message or, once signed in, a stamp of your own that Swarm ID holds.

**What is built.** The stream list, the watch page with a player that reads only the quality it
plays and finds the newest playlist from the ladder's time markers, My Swarm over a Swarm
client made of providers, and a chat beside each stream, in the Swarm Brand v3.0 look.

It is built from the viewer of
[streaming-monorepo](https://github.com/Solar-Punk-Ltd/streaming-monorepo) and the Swarm design and
chat of [msrs-client](https://github.com/Solar-Punk-Ltd/msrs-client).

## Run it

You need Node.js 24 or later. pnpm comes through Corepack, at the version `package.json` names.

```bash
corepack enable
pnpm install
pnpm dev
```

The dev server opens at `http://localhost:5173`. Before it shows any streams, fill in
`public/config.json` (see below).

The dev server and `pnpm preview` forward `/bee` to a Bee node on this machine,
`http://127.0.0.1:1633`, so a config whose `gatewayUrl` is `/bee` works without the node allowing the
page's origin. Set `DEV_BEE_PROXY_TARGET` to forward it somewhere else.

## Configure it

Every setting is read from `config.json`, served beside the page, when the app starts. One build
serves every deployment, and a setting changes without a rebuild. A page that cannot read its config,
or finds a value it refuses, says which field is wrong instead of showing an empty list.

The repository's `public/config.json` is an example with placeholders. The page refuses to start on
a value still in `<angle brackets>`, so the example can never pass for a real deployment. Real values
live with the deployment, never in this repository.

| Field           | What it is                                                                                                                                                                                                                                                            |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `gatewayUrl`    | The event gateway: a path on this site such as `/bee`, which the site proxies to Bee, or an http or https address of a Bee node. Set this or `providers`, not both                                                                                                    |
| `providers`     | Optional in place of `gatewayUrl`. The gateways offered and the default, below                                                                                                                                                                                        |
| `catalog.owner` | The Ethereum address that owns the stream list feed                                                                                                                                                                                                                   |
| `catalog.topic` | The stream list feed's topic, as text                                                                                                                                                                                                                                 |
| `chat`          | Optional. The chat's settings, below. Without it, or with `enabled` false, there is no chat anywhere on the page                                                                                                                                                      |
| `theme`         | Optional. Which of the build's themes the page wears, `swarm` by default. A name the build does not carry is refused                                                                                                                                                  |
| `themeSwitcher` | Optional. Whether a viewer logged in to the chat may switch the colours and typefaces between the build's themes, `true` by default                                                                                                                                   |
| `swarmId.url`   | Optional. The Swarm ID site a viewer may sign in to the chat with, an origin such as `https://id.example.com`. Without it, or without a chat, there is no sign-in                                                                                                     |
| `ensRpcUrl`     | Optional. An Ethereum mainnet JSON-RPC endpoint, an https address, or http on `localhost`, `127.0.0.1`, `[::1]` or a `.localhost` name, that the page reads senders' ENS names through ([ENS names](#ens-names)). Without it, or without a chat, no name is looked up |

A theme has two halves. Its look, the colours and typefaces, is in `src/design/themes/`. Its content, the
logo, the hero, the footer links and the tab's title and icon, is in `src/design/themes.ts`. The deployment's
`theme` decides both. Every theme defines the same variables, so a page that wears another theme's look leaves
nothing unset, and the tokens test fails on a theme that misses one or on a text colour below 4.5:1.

**The theme switcher.** A viewer in the chat finds a Theme group under their ID in My Swarm, one
option per theme with a swatch of its page colour, accent and heading typeface. The arrow keys move the pick
within the group, and Tab reaches it at the checked option. A pick changes only the look.
The logo, the words and the tab stay the deployment's, so a Devcon page in the web3privacy look still says
Devcon. The pick is kept in this browser under `viewer-theme`, through reloads and after a logout, and on
the next visit it is worn before the page renders, while the config is still loading. A deployment without chat has no login, so it has no switcher
either, and one with `themeSwitcher` false keeps a viewer's earlier pick without wearing it.

The `chat` block. With `enabled` true every field must be filled in, and the page refuses to start
otherwise. With `enabled` false the other fields are not read.

| Field                 | What it is                                                                                                                                                       |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `chat.enabled`        | Whether the page has a chat                                                                                                                                      |
| `chat.readUrl`        | Where the chat's feed and history files are read: a path on this site or an http or https address                                                                |
| `chat.writeUrl`       | Where chat messages are written, an endpoint that stamps each write: a path on this site or an http or https address. The one `chat.beeUrl` of before is refused |
| `chat.gsocResourceId` | 32 bytes as 64 hex digits: the key every viewer writes chat messages with. Shared by design and public, not a secret (below)                                     |
| `chat.gsocTopic`      | The topic of the address the chat aggregator listens on                                                                                                          |
| `chat.feedOwner`      | The Ethereum address that writes the chat feeds, which is the aggregator's                                                                                       |
| `chat.pollIntervalMs` | How often an open chat reads its feed, in milliseconds. A positive whole number, raised under load without a rebuild                                             |

The `providers` block names more than one way of reaching Swarm. A config that names only `gatewayUrl` is
read as one Bee gateway and the default, so a deployment written before `providers` needs no change.
Nothing switches source by itself: a part reads from the source the viewer picked and from nothing else,
and when that source fails the page says so and the viewer picks another. The chat history is read from the
source picked for it, and the default gateway's at `chat.readUrl`.
The page's policy allows every https address, so a gateway in `providers.gateways` at an https address
needs nothing more. One at a plain http address must also be named in the image's `EXTRA_GATEWAY_URLS`
(below), or the policy refuses it, unless it is the image's own `BEE_GATEWAY_URL` in direct mode.

The page, not the deployment, decides which kinds of source a viewer may add: a gateway at an https
address, a Bee node on this computer or at an https address, and the node in this browser. No setting
turns a kind on or off. A deployment written for an earlier release may still name `providers.fallback`,
`providers.kinds`, `providers.beeNodes` or a `weeb3` block, and the page reads none of them.

| Field                       | What it is                                                                                                      |
| --------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `providers.gateways`        | The gateways offered, at least one. Each has an `id`, a `kind`, an optional `label` and its own settings        |
| `providers.gateways[].kind` | `bee-http`, a Bee node's HTTP API, the only kind a deployment may offer as a gateway. Any other kind is refused |
| `providers.gateways[].url`  | For `bee-http`: a path on this site such as `/bee`, or an http or https address, as `gatewayUrl` takes          |
| `providers.default`         | The `id` of the gateway every reader starts on                                                                  |

Serve `config.json` with `Cache-Control: no-store`, so a changed setting reaches every page opened
after the change.

## The chat

One chat per stream, beside the video on a desktop and under it on a phone, where it folds away.
Anyone can read it. Writing asks once for a display name, 1 to 20 characters with no invisible formatting or control
character such as a right-to-left override. The zero width joiner and non-joiner are allowed, since joined emoji
and Persian or Indic names need them. A name ending in .eth, in any case or with lookalike letters or dots such as the
fullwidth ones, is refused with "Names ending in .eth are kept for ENS names.", since only a verified ENS name shows
as one. There is no
password, wallet or account. A deployment that names a Swarm ID site in `swarmId.url` also offers
signing in with Swarm ID, described [below](#signing-in-with-swarm-id). A viewer can send a message, react with an emoji, reply in a thread,
load older messages, and retry a message that did not send. A message lights up under the pointer and shows its
reaction and reply buttons there, as focus inside it does, and on a touch screen a tap shows them. The emoji bar's
last button opens every emoji above the field, with its close button above the picker. The chat and its library are a file of
the bundle of their own, fetched as the watch page opens, beside the video rather than after it, and
the emoji picker is fetched the first time one is drawn: the emoji bar above the message field, or a
reaction's picker beside a message.

**What it needs, outside this repository.** Two services, set up apart from this app:

- **Two Bee endpoints for the chat.** `chat.readUrl` serves the chat's feed and history files.
  `chat.writeUrl` takes the messages and stamps every write, because the page holds no postage stamp.
  A message costs one stamped chunk, and one more for each resend while it has not been read back. A viewer who
  pays with their own stamp, [below](#who-pays-for-a-message), sends through their own Bee node or through Weeb3
  instead.
- **The chat aggregator**, on swarm-chat-js 9, which listens on the shared address the key and topic above name, and
  appends each message to the stream's chat feed, `chat-<stream topic>` under `chat.feedOwner`.
  Opening a chat reads the newest history file the chat feed points to, then the entries after it. When the feed's
  newest entry is not found in time, as through Weeb3 where every entry not there costs a long wait, the library
  opens the chat empty and reads on from its first entry, and the chat says "Loading the chat…" until that read
  answers. "No messages yet." shows only once it found nothing. The endpoint viewers write
  through must be a different Bee node from the one the aggregator listens on, because Bee hands a
  message on to a listener only when it arrives from another node.

**Why `gsocResourceId` is not a secret.** Every viewer writes to the same shared address, so every
viewer's page carries the same key. It is chosen so the address lands where the aggregator listens,
and it owns nothing but that shared chat address, which every viewer writes to anyway. A check for
keys in the tree has to know it.

**What the browser keeps.** A guest's display name, the chat key made for it (32 random bytes from the
browser's own crypto) and its address sit in local storage under `stream-event-client:chat-session`,
so a reload keeps the name. Logging out, or Leave beside Swarm ID, removes them. The guest's key proves only
that two messages came from the same browser, and anyone may choose any name. So the badge beside a guest's name
opens the details, where the sender's full public address tells apart two people who chose the same name.

Nothing of a Swarm ID sign-in is kept there. What a Swarm ID account picked for paying, the gateway or its own
stamp, sits under `stream-event-client:chat-stamp:<its chat address>`, one entry per account, so another account
signing in on the same browser starts with the gateway paying.

**What the chat checks, and the badges.** Every message is signed by its sender's chat key. The page
checks each one, live, from history and the viewer's own while it is still sending, in a Web Worker
with swarm-chat-js's `verifyChatMessage` and the page's own origin, so a long history never holds up
the page. History is checked in batches of 25, and each batch shows as soon as it passed. A message is
shown only once it passed. One that fails, whether its text was changed after signing, its Swarm ID
binding was made for another site, or it is in the format before version 8, is never shown, and the
panel counts them in its `data-refused-messages` attribute. A chat whose history is all of the older
format opens as an empty chat. The worker is the bundle's own file, so the page's policy allows it with
`worker-src 'self'`. A worker that cannot start or fails is left, and the same check runs on the
page's thread instead, for the messages it held and every later one. Nothing is shown unchecked and
nothing is left waiting.

Above each message is its sender line: the name, the badge, the stamp for a message sent with the
sender's own stamp, and the time it was published, in hours and minutes on the viewer's clock. There
is no initial and nothing floats over the row. A grey outline hexagon after a name in the plain weight
is a guest, told apart only by the key their browser keeps. A filled hexagon with a check
after a name in the accent colour is a Swarm ID account, which signed a statement that this chat address
on this site is its own. A stamp after the badge says the sender paid for the write with a stamp of
their own. Every message this page sends says who paid, the event gateway or the viewer's own stamp. The badge, and the stamp where
there is one, open the message's details, across the chat column: the name with its badge, the identity (Guest or Swarm ID), the
public chat address, a check mark for a signature that matches the text, for a Swarm ID the account's address, and
who paid for the write (Event gateway or Own stamp). An address shows short, `0x0d7f…ab12`, and a press shows it in
full with a Copy button beside it, which reads Copied for three seconds after a copy, and a screen reader hears that the
copy worked. A press on the check mark shows the signature the same way. For a message sent with its sender's own
stamp, the details also compare the sender's own feed, `ownFeedTopic(chatTopic)` under their chat address, with the
chat: **Own feed: N messages**, **Chat feed: N messages on their own stamp**, a tick and In their own feed when this
message has its copy there or Not in their own feed when it has none, and, when the two differ, which messages are
missing from their own feed and which from the chat feed, five of each at most, newest first. Only the sender's
messages on their own stamp count, since a message the gateway paid for never gets a copy. They say Counting… while
they read, No own feed when the sender keeps none, Their own feed could not be counted with Try again when a read
fails, and Their own feed is too large to count when it names more entries than the sender's messages in the chat
and 25 more, or more than 1,000. Both are read through the source picked for Chat history: the chat feed from its
newest entry back through its history files, each file older than the one before and 50 at most, and each entry no
file holds read by its own index, 500 at most, then the own feed from its first entry to its newest. Past those
limits the chat is not counted. An entry the source answers is not there counts as missing, by the rule the chat
reads its slots with, so a 404 or the 500 a Bee 2.6 cluster gives a slot never written, and any other answer
makes the count fail rather than call a message missing. Each copy is read by its address and must be the sender's
own single-owner chunk, and every copy and every chat message must pass the same check as a message shown in the
chat and be for this chat, the copies also the sender's, or it is not counted. A copy and a chat message are the same
message when their signatures are: a message has one valid signature, over every field it says, so a copy with the
same signature is the message the chat feed shows, as far as the chat server that writes the feed is trusted. One
walk of the chat is shared by every details card and My stamp while a chat is on screen, a finished count is shown
again for three minutes, at most 32 are kept, and closing the details stops their reads. The comparison only reads
(`src/features/chat/stamp/ownFeedComparison.ts`, `src/features/chat/stamp/ownFeedCounter.ts`).

### Signing in with Swarm ID

My Swarm offers two ways in. **Chat as guest** takes a name, as above. **Sign in with Swarm ID**
is Swarm ID's own button, a small frame of the Swarm ID site in My Swarm, and its click opens the Swarm ID window,
which the Swarm ID site draws, not this page. The person picks an account
there, or makes one. The ID then gives this site its chat key for that account and a chat binding, the
account's signed statement that the key's address on this site is its own. Every message is signed
with that key and carries the binding, so every reader shows the Swarm ID badge. The page never
connects a wallet and never sees the account's own key. Messages go through the event gateway, which
stamps them, unless the person picks their own stamp, as the next section says.

- **The Bee node Swarm ID uses for this site.** The page hands Swarm ID the address of the source picked
  for the chat history, as a Bee API base, when it starts the library and again whenever that source
  changes, so this site's content in Swarm ID follows the viewer's choice. For the event gateway that is
  `chat.readUrl`. A source with no Bee address, the node in this browser, is never handed over, and Swarm
  ID then keeps the address it had, as it does when it refuses one, which is asked for again at the
  next change. Swarm ID's coordination of the person's account and devices stays
  on their own node whatever this page names. The address is handed over absolute, so `/bee` arrives as
  this site's own `/bee`.
- **Swarm ID reads that address from its own origin**, through its hidden frame, so the address has to
  let the Swarm ID site read it. The image does this for `/bee` in proxy mode when `SWARM_ID_URL` is set:
  `/bee` then answers that one origin, never `*`, with the gateway's own CORS headers replaced, and answers
  a preflight for GET itself. The image serves nothing else Swarm ID may be handed. **A deploy requirement:**
  `chat.readUrl`, a gateway in direct mode and every gateway in `providers.gateways` are on hosts of their own,
  and each has to allow the Swarm ID site's exact origin for GET itself, or Swarm ID cannot read this site's
  content through it.
- **The chat name** is the account's name, trimmed and cut to the chat's 20 characters. An account
  with no name, or with one the chat refuses, such as one ending in .eth, chats under its short address. The header shows the chat name with its badge, the grey
  hexagon of a guest or the filled one of Swarm ID, as every message does. My Swarm shows the name once, says "Swarm ID",
  with the account's own name beside it only where it differs from the chat name, and Sign out. Under them are the
  public chat address and the Swarm ID account's address, each short and expandable as in a message's details.
- **The wallet link, for an ENS name.** While the person has "Show my ENS name on sites" on in Swarm ID, the ID
  also shares a wallet link: a statement signed by the account's wallet and countersigned by the account that the
  two belong to the same person. Every message then carries it beside the binding, so a reader can show the wallet's
  ENS name, as [ENS names](#ens-names) says. The page checks the link first, as every reader will, and leaves out
  one that does not name the signed-in account, so the person still chats and no reader refuses their messages.
  Without the setting nothing of the wallet is sent. The page follows the newest session Swarm ID reports, so turning
  the setting off or on while signed in reaches the very next message, one already typed among them. Swarm ID reports
  the change at once to an open page, and on its next load to a page that was closed. Messages already sent keep the
  link they carried.
- **A guest can sign in later.** The menu of a guest says "Show it's really you" beside Sign in with
  Swarm ID. Signing in keeps the guest's name and key in this browser, and signing out chats as that
  guest again. Leave forgets the guest.
- **What stays in memory only.** The chat key, the binding and who is signed in are never written to
  storage. A reload asks the Swarm ID library, whose frame keeps its own session for this site and
  signs the person in again without a window. When that session has ended, the person signs in again
  and the window opens again. Sign out ends that session too, so a reload does not restore it.
- **Why the button is Swarm ID's own.** The viewer and the Swarm ID site are on different sites, so the browser keeps
  Swarm ID's frames in this page apart from the Swarm ID site's own storage, as Chrome does. The session reaches such
  a frame only from a window a Swarm ID frame opened itself, and a frame may open a window only after a click inside
  it. A window the page opened from a button of its own would end on Swarm ID's "Connected" with this site still
  signed out, so the page has no button of its own for it and never opens the window. The library's `mountButton`
  shows the button, in a container the page sizes, and the page hands it the label in the design's words and the look
  of the page's own button it replaced, read from the theme the page wears: the primary button in My Swarm's sign-in
  and in the warning above the message field while sending is held, and the secondary one beside a guest's name, in
  the stamp group and in a warning that lets sending go on. That is the button's fill and label colours, corner radius,
  typeface, size and weight. A viewer's theme switch changes the button in place.
- **The button's typeface is the page's own.** The page hands Swarm ID's frame the font file the build bundles for the
  theme's typeface at the button's weight, Geist for the Swarm theme and Archivo for Web3Privacy, the Latin file at
  semibold or bold, at its address on this site, and the frame loads it itself. It is the same file the page's
  stylesheet uses. The frame fetches it from its own origin, so the image serves the font files with an
  `Access-Control-Allow-Origin` naming the `SWARM_ID_URL` site. A deployment whose fonts do not allow that site, such
  as one served by something other than the image, gets the frame's fallback typeface and a line in the frame's
  console. Swarm ID takes a font file only over https, or over plain http on this machine, so a page served over
  plain http elsewhere hands it none.
- **The button is mounted once for as long as it is shown.** Closing My Swarm takes it away and leaves the session as
  it is.
  Until Swarm ID's frame shows its button, a placeholder stands in its place: the page's own button of the same look
  and size, with its label and a small loader, which takes no click and no focus. To a screen reader it is a picture
  named "Connecting to Swarm ID", and a status that stays in place says the same. The frame then shows the button
  in the same place, so nothing moves. When the wait passes 30 seconds, a line under it says "Swarm ID is taking
  longer than usual." in that same status. That place is
  never narrower than the label with its loader, so the smaller button beside other words, as in Show it's really
  you, shows its whole label down to a 320 px wide screen. A Try again shows
  the placeholder again until the new button is ready. When Swarm ID refuses the
  button, or it does not answer within the library's 30 seconds, its place says "Swarm ID cannot be reached right
  now." with Try again, which takes that button away and mounts a new one, and the console warns once as for a Swarm
  ID that does not start. A viewer already signed in stays so. The button's label is also its accessible name.
- **A blocked window.** The click is Swarm ID's own, so a browser opens the window unless it blocks pop-ups outright.
  When it does, the line under the button says "Your browser blocked the Swarm ID window. Allow pop-ups for this
  site, then press the button again." The page has no window of its own to offer instead.
- **A binding the chat would refuse** is refused at sign-in rather than at every message: one made for
  another site, naming another address than the key's, or signed by another account than the one the
  frame says is signed in, leaves the person signed out with the reason.
- **When the Swarm ID site cannot be used**, as for a site it does not serve, My Swarm says it
  cannot be reached and guests chat as before.

### ENS names

A Swarm ID sender who has "Show my ENS name on sites" on carries a wallet link in every message, as
[above](#signing-in-with-swarm-id) says. The page's check in the Web Worker verifies both of its signatures and that
it names the account the binding names, and only then does the message say which wallet it is. The page then looks
that wallet's ENS name up through `ensRpcUrl`, an Ethereum mainnet JSON-RPC endpoint the deployment names, with the
Swarm ID library's `resolveVerifiedEnsName`. A name counts only when the wallet's reverse record names it and the
name's own record names the wallet back, and it is already in its ENSIP-15 normalised form.

- **What a reader sees.** The verified name replaces the name the sender chose, on the message and at the head of its
  details, with the Swarm ID badge as for any Swarm ID sender and no mark of its own. The details add an **ENS** row
  with the name and a tick, which a screen reader reads as "ENS name checked", the name the sender chose and the
  short wallet address, which a press shows in full. A name with characters outside ASCII says "contains non-Latin
  characters" there, because such a character can pass for a Latin letter of another name, and carries a small mark
  with that label beside it on the message. A long name ends in an ellipsis on the message, whole under the pointer
  and in the details. Every name is drawn isolated from the text around it, so its direction never moves the badge,
  the time or the message.
- **When there is no name.** A wallet with no name, a name that fails a check and a lookup that fails or runs out of
  time all show the message as before, under the name the sender chose, with no ENS row.
- **When it looks.** After a message is drawn, never before it, so a slow endpoint holds nothing up. Messages of one
  wallet share one lookup, at most four lookups run at once, and a name found is kept for ten minutes, so a name
  moved to another wallet shows within that. The library keeps its own answers too, a name or no name for ten
  minutes and a failed read for 30 seconds.
- **Without `ensRpcUrl`**, or without a chat, no name is ever looked up and no wallet is ever asked about.
- **Whom the endpoint is trusted with.** It decides which name is shown beside a wallet, since nothing checks its
  answers against the chain, and it sees every wallet looked up, from each viewer's own address. A deployment names
  an endpoint it trusts with both.

### Who pays for a message

My Swarm has a **Chat stamp** group, between ID and Swarm access, once the viewer is chatting. Every message on
Swarm needs a postage stamp, and the group offers two ways to pay.

- **Gateway pays**, the default for everyone, as before: the message goes to `chat.writeUrl`, which stamps it. That
  holds with Weeb3 picked for Chat history too: the page holds no stamp, and only the event's write path has one to
  pay with, so the history is read through Weeb3 and the message is written through the event's gateway.
- **My stamp**, offered once signed in with Swarm ID. The stamp is the one Swarm ID gives this site. It is bought,
  topped up, made bigger and chosen for the site in Swarm ID, never in this page, which holds no stamp and no stamp
  key. For each message the page builds the chunk, Swarm ID signs and stamps it in its frame with `stampChunk`,
  and the page sends the stamped chunk itself through the source picked for **Chat history** in Use for: to a Bee
  node as `POST /soc/<owner>/<id>?sig=...` with the stamp in Bee's `swarm-postage-stamp` header, or through Weeb3
  with weeb-3's `postPushChunk`, the whole chunk at its address with the stamp's 113 bytes. Every message says
  `via: "own-stamp"`. The chat's inbox is one single-owner chunk address, which Swarm ID stamps again in the slot
  it already holds, so a busy chat costs one slot of the stamp rather than one per message.
- **Which source can send it.** Only a Bee node of the viewer's own and Weeb3, the node in this browser, send a chunk
  under a stamp they are handed, so My stamp needs one of them picked for Chat history. The event gateway's chat path
  stamps every write with the gateway's own batch, a `/bee` path on the site passes reads alone, and the page cannot
  tell what any other gateway does with a stamp. So while My stamp cannot be picked, its line says what it needs,
  "Needs Weeb3 or your own Bee node for Chat history.", with a Swarm ID sign-in named first for a viewer who is not
  signed in. The warning above the message field still says why the gateway picked cannot send. The Bee node must allow this site's origin
  (`cors-allowed-origins`) for the write as for its reads, and needs the stamp's chain to check it, so a light
  node or a full one, not an ultra-light one.
- **Nothing switches by itself.** A message Swarm ID will not stamp, or the node refuses, shows "Not sent." with
  the reason, and is never resent through the gateway. A refusal a resend cannot mend, such as a stamp that ran
  out, fails the message at once, and Retry tries it again on the same stamp. A node that did not answer, or a
  busy Swarm ID, is resent by the chat on its own, on the same stamp and through the same node. When Swarm ID says
  it has given this site no stamp, which since Swarm ID 0.10.0 is every site until the person picks one there, the
  message reads "Not sent. Swarm ID has given this site no stamp. Choose one in Swarm ID." and the field above the
  message box shows No stamp for this site with Choose a stamp in Swarm ID at once, even when the stamp read last
  named one. When the source
  picked for Chat history changes to one that cannot send on the stamp, the choice stays, sending is held with
  the reason, and the viewer picks a Bee node or Weeb3 again or presses Let the gateway pay. Retry resends only
  through the sender that took the message. After the viewer changes who pays, the source, the sign-in or the own
  feed, or restarts the chat, that sender is gone, so Retry marks the message "Not sent. The way messages are sent
  changed, so write it again." and takes its Retry button away, never resending it through the new route.
  A message sent in the moment such a change, or a new name or wallet link, restarts the chat waits for the new chat
  and goes out once, with the name, wallet link and payer in force when it goes. When no chat starts within ten
  seconds it is not sent, and the field keeps it with "The message could not be sent. Try again."
- **A deadline on every push through Weeb3.** weeb-3 answers a stamp it will not take with silence, never an error,
  so each push has a minute (`WEEB3_PUSH_DEADLINE_MS`, measured pushes took 7 to 15 s). A push with no answer by then
  fails the message at once, "Weeb3 did not confirm it within a minute.", and the chat does not send it again by
  itself, since a second try on the same stamp would wait the same minute. Retry tries once more. A refusal weeb-3
  names fails at once too, and a node that is not running is started again by the chat's own resend. A stamp from
  Swarm ID that is not exactly 113 bytes never reaches weeb-3: the message fails at once, "Swarm ID gave a stamp of
  the wrong size." Anything else that fails on the way, such as a chunk that could not be built, fails the message
  at once as "Weeb3 could not push it", with what went wrong. The own-feed copy goes through Weeb3 the same way,
  after the message. **A known limit:** the deadline does not cancel the push, since weeb-3 offers no way to. A
  valid push slower than a minute is reported as refused, the node is let go, and weeb-3 may still deliver the
  message later, when the chat reads it back.
- **The stamp's figures.** With My stamp picked, My Swarm shows the site's stamp: its name, how full it is, its days
  left, and **Change stamp in Swarm ID**, Swarm ID's button again, whose click opens the Swarm ID sign-in window
  while the viewer stays signed in (the button's `change-stamp` action). The window shows the person's stamps, the person picks one for this site,
  and Swarm ID hands it to the open page at once and reports the session again (`onConnectionChange`) with the id
  of the stamp the site now uses (`postageBatchId`). When that id changed, the viewer reads the new stamp's figures
  with `getPostageBatch` straight away, with no reload, and a report naming the same stamp reads nothing. A browser
  that blocks that window gets the same line as a blocked sign-in, under the button. The figures are also
  read when the person signs in, when My Swarm opens, when the page comes back into focus, and after messages sent, at
  most every 15 seconds. **A known limit:** a stamp changed directly on Swarm ID's own Apps screen, rather than
  through this button, reaches an open viewer on another domain only at its next sign-in with Swarm ID, so until
  then the viewer may show the old stamp's figures. A report with no stamp id means Swarm ID gives this site no
  stamp, and the page shows that at once without reading. Every sign-in starts that way until the person confirms a
  stamp with Go to app in the Swarm ID window, so My Swarm says "Swarm ID has given this site no stamp yet. Choose
  one and confirm it in the Swarm ID window." and the same button reads Choose a stamp in Swarm ID until it has one.
- **Warnings above the message field.** At 80% used, or 3 days left, the field says how much is used and when it
  runs out, offers Change stamp in Swarm ID, Swarm ID's button, and sending goes on. When the stamp ran out or is not
  usable yet, the field says so, sending is held with what was typed kept, and two buttons offer Change stamp in Swarm
  ID and Let the gateway pay. When Swarm ID gives this site no stamp the first button reads Choose a stamp in Swarm ID. When
  the source picked for Chat history cannot send on the stamp, the field says why, sending is held, and the buttons
  are Open My Swarm and Let the gateway pay. A Swarm ID window the browser blocked adds its own line under Swarm ID's
  button there.
- **The copy in the viewer's own feed.** Always on with My stamp, with no setting to turn it off, and the My stamp
  box says so. Once the viewer's node took a message, a copy of it goes into the sender's own feed,
  `ownFeedTopic(chatTopic)` from swarm-chat-js under the chat key's address, one entry per message at the next index,
  stamped by Swarm ID too. The message goes out at once and never waits on its copy, and nothing in the message says
  whether there is one: anyone compares the own feed with the chat instead. A copy is the message's bytes exactly as
  they were sent. The feed's newest index is read once, through the chat history's source, and counted on from there.
  A copy whose lookup or write fails is tried three times in all, three seconds apart, and then left, and a copy
  that fails never fails its message. A copy given an index keeps it until it is written there, since its write may
  have landed although it reported a failure, so the next copy first writes it there again and the feed never holds
  two different copies at one index, or a gap (`src/features/chat/stamp/ownFeedCopies.ts`). Each message is stamped
  twice, but the message itself goes to the chat's inbox address, which Swarm ID stamps again in one slot, so only
  the copy takes new room on the stamp.
- **Own feed in My Swarm.** While a chat on My stamp is on screen, the My stamp box says under the stamp how many of
  the viewer's messages on their own stamp in that chat have their copy, as in Own feed: 45 of 47 messages, and 2
  missing when some have none, with a **Sync** button. It reads the chat and the own feed as the message details do,
  within the same limits, and the viewer's messages are the ones signed by their chat address, which is the same on
  every device. A message the gateway paid for is not counted and never copied. Sync writes the missing copies with
  the stamp, one after the other, each tried three times as above, and says Syncing… 1 of 2 while it runs, then All
  47 copied. It stops at the first copy that fails, since every later copy would try that one again first, and says
  how many were not copied, that one and the rest, with Try again. Once a sync ends it counts again, and so it does
  after each message the viewer sends, once it is read back and its copy written or given up, behind the count on
  screen. It says Counting… while it first reads, and Your own feed is too large to count past the limits.
  **A known limit.** The next index is counted from one read of the feed's newest entry each time the chat starts,
  so a chat started again seconds after a send, before that entry can be read back, or another device writing the
  same feed at once, can write a copy at an index already used.

**How the page talks to Swarm ID.** The library, `@solarpunkltd/swarm-id` from the Solar Punk fork, is a file
of the bundle of its own, fetched when the page starts on a deployment that offers Swarm ID, because
restoring a session needs it. It embeds a hidden frame of the Swarm ID site, and Swarm ID's button is a second,
visible frame of the same site, which is why the image's `SWARM_ID_URL` adds that site to the policy's `frame-src`,
and talks to both with `postMessage`. The window is a window of its own, opened by the button's frame, which the
policy does not govern.
`config.json` is mounted rather than written by the image, so the site is named twice, and
`SWARM_ID_URL` and `swarmId.url` must be the identical origin. When they differ the policy refuses the
frame, the page offers no sign-in, and the console warns once, naming both settings. It warns the same
when the Swarm ID site does not start for this page at all.
Everything the viewer uses of the library goes through `src/features/chat/swarmId/`, and only
`swarmIdLibrary.ts` there imports it.

**What the Swarm ID site requires.** It serves only the sites on its allow list, an ENS text record
(the fork's `docs/Site-Allow-List.md`), and refuses any other: the library cannot start and the page
offers no sign-in. A site is added by its exact origin, `https://` and the host as the browser reports
it. For local work, a development build of the Swarm ID site also serves the origins named in its
`PUBLIC_SITE_ALLOW_LIST_DEV_ORIGINS`, which may be local http, such as the dev server at
`http://127.0.0.1:5173`. Serve the viewer and the Swarm ID site on different sites, such as the viewer
at `127.0.0.1` and the Swarm ID site at `localhost`. On the same site the frame reads the session from
storage it shares with the Swarm ID site, and a session read that way carries no binding, so the page
says Swarm ID signed in without confirming a chat address and stays signed out. A binding for a local
http site passes only on a page served over local http, as `pageScope` decides for every check.

## Build it

```bash
pnpm build     # typecheck and bundle into dist/
pnpm preview   # serve dist/ locally
```

`dist/` is a static site. Serve it with a fallback to `index.html` and with its `config.json` beside
it, or run the image below, which does both.

The other scripts: `pnpm test` (vitest), `pnpm lint` (oxlint), `pnpm typecheck`, `pnpm format` and
`pnpm format:check` (oxfmt). `pnpm e2e` builds the app and runs the browser journeys in Playwright:
a replayed recording, the theme switcher on that recording, My Swarm, the weeb-3 journeys, chat messages on the
viewer's own stamp against a fake Swarm ID site on that recording, through a Bee node and through a fake Weeb3, signing
in and changing the stamp through that site's button frame, and real hls.js against a fake gateway publishing a live stream in four
qualities, each answer held back 650 ms. The first run downloads the Chromium build Playwright pins.
Beyond that they need no Bee node and no network, and they print their timings and read rates
without asserting them. Continuous integration runs the format check, lint, typecheck, tests, build and `pnpm e2e` on every
pull request, and reports what the first page load downloads.

`pnpm test` also holds the count of exports nothing else imports at or below the number in
`scripts/unused-exports-baseline.json`. `node scripts/unused-exports.mjs --list` names them, and
after removing one, `node scripts/unused-exports.mjs --write` lowers the baseline so the gain is kept.

## Run the image

The `Dockerfile` builds one image for every deployment: nginx serving the built page, with the page
fallback, and the gateway at `/bee` when it is proxied. What a deployment differs by is read when the
container starts.

```bash
docker build -t stream-event-client .
docker run -p 8080:80 \
  -e BEE_GATEWAY_URL=https://gateway.example.com \
  -e CHAT_READ_URL=https://chat-read.example.com \
  -e CHAT_WRITE_URL=https://chat-write.example.com \
  -v "$PWD/config.json:/usr/share/nginx/html/config.json:ro" \
  stream-event-client
```

| Setting              | What it is                                                                                                                                                                                                                                    |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GATEWAY_MODE`       | `proxy`, the default: the page reads the gateway at `/bee` on its own origin, so `config.json` names `/bee` as `gatewayUrl`. `direct`: the page reads the gateway at its own address, which `config.json` names                               |
| `BEE_GATEWAY_URL`    | Required. The gateway's address, with no path. In proxy mode `/bee` forwards to it. In direct mode the page reads it, which the policy allows at https, and names at plain http                                                               |
| `CHAT_READ_URL`      | The chat's read endpoint, the same as `chat.readUrl` in `config.json`. Checked at start, and named in the policy when it is plain http. Leave it out when there is no chat                                                                    |
| `CHAT_WRITE_URL`     | The chat's write endpoint, the same as `chat.writeUrl`, checked and allowed the same way. The one `CHAT_BEE_URL` of before stops the container                                                                                                |
| `EXTRA_GATEWAY_URLS` | Optional. The addresses of the further gateways `config.json` offers in `providers.gateways`, separated by spaces, each with no path. Checked at start, and the plain http ones named in the policy                                           |
| `SWARM_ID_URL`       | Optional. The Swarm ID site, the identical origin to `swarmId.url` in `config.json`, which the page is then allowed to frame, and which may then read `/bee` in proxy mode and the bundle's font files. Leave it out when there is no sign-in |
| `config.json`        | Mounted over the image's example at `/usr/share/nginx/html/config.json`. Without it the page shows the example's placeholders as a configuration problem                                                                                      |

A setting that is missing or malformed stops the container at start, and its log says which one.
`BEE_NODES` and `WEEB3`, which earlier images read, are no longer read, because the policy below now allows every
kind of source on every deployment. A deployment may drop them, and setting them changes nothing.

### What the page may reach

The policy is the same on every deployment, because the page decides which sources it offers:

- **Any gateway, and a Bee node, at an https address.** `https:` in `connect-src` and `img-src`, so the
  page reads it and shows its pictures. A gateway's address is the viewer's to choose, so no list of
  hosts could hold them all.
- **A Bee node on the viewer's own machine**, at `localhost` or `127.0.0.1`, any port, over plain http,
  in `connect-src` and `img-src`. A policy cannot name `[::1]`, so that address is refused where it is
  typed, with what to type instead.
- **The ENS endpoint**, `ensRpcUrl` in `config.json`, at an https address, under the same `https:` in
  `connect-src`, so the image needs no setting for it. One at plain http is reached only on the viewer's own machine.
- **The node in this browser, weeb-3.** `'wasm-unsafe-eval'` in `script-src`, so the page and its
  workers may compile the WebAssembly module, and `wss:` in `connect-src`, so the node can reach its
  peers. That is every secure websocket host, on purpose. The package's mainnet bootnodes are all
  `*.libp2p.direct` names, which `wss://*.libp2p.direct:*` would cover, but the node also dials any peer
  that announces a public DNS name with TLS, and a narrower list would refuse those.

Plain http beyond the viewer's own machine is never allowed, apart from the addresses the image's
settings name, because a browser blocks it from an https page and a policy cannot tell the local network
from the internet. Blob URLs stay media, image and worker sources and are never added to what the page
connects to.

`/weeb-3/` always serves weeb-3's files: the WebAssembly module as `application/wasm`, and its service
worker at `/weeb-3/service.js` with `Service-Worker-Allowed: /`, because the worker answers the node's
`/weeb-3/...` routes for a page anywhere on the site. Every file there is answered `no-cache` and a missing
one is a 404, never the page. weeb-3 keeps every route under `/weeb-3/` at the site's root, so the viewer is
served at the root.

### The release tag and the build label

A `v*` tag publishes the image, built for amd64, as `ghcr.io/solar-punk-ltd/stream-event-client:<tag>`
(`.github/workflows/image.yml`). A deployment pins it by the digest that tag resolves to. No tag ever
moves `latest`.

The workflow passes the tag and its commit into the build as `BUILD_TAG` and `BUILD_COMMIT`, and the page's Copy
diagnostics names the build by them, such as `v1.7.0-rc.5 (1fcfbd4)`. A build without them, such as `pnpm build`
in a checkout, asks git instead: the tag on the commit, an annotated one before a lightweight one, else the nearest
tag behind it and the commits past it, such as `v1.7.0-rc.5+3 (8e2d0aa)`, else the short commit alone, with
`-dirty` added when the tree holds uncommitted changes. With neither, as in a plain `docker build`, which
leaves `.git` out, it says `development build`. A `BUILD_TAG` that is not a plain tag name, letters, digits
and `. _ + / -`, or a `BUILD_COMMIT` that is not hexadecimal stops the build rather than reaching the page.
`scripts/build-label.mjs` holds the rule.

### Testing the image

`pnpm test:image` builds the image and checks it running, in both modes: `nginx -t`, the cache
headers and the policy on each kind of answer, reads and refused writes at `/bee`, weeb-3's files, and the
refusal to start without `BEE_GATEWAY_URL`. It needs a Docker daemon, so it is not part of `pnpm test`. `pnpm test:docker` runs it and then
records the browser smoke test's answers, which is what a job with a Docker daemon runs.

- **Caching.** The page is served `no-cache`, so a browser asks before reusing it after a deploy.
  `config.json` is served `no-store`. The bundle under `/assets/` is named by content hash and kept
  for a year.
- **Font files for Swarm ID's button.** With `SWARM_ID_URL` set, the bundle's `.woff2` files answer with
  `Access-Control-Allow-Origin` naming exactly that site, because Swarm ID's button frame loads the page's typeface
  from its own origin. No other file gets the header, and without `SWARM_ID_URL` no file does.
- **Content security policy.** The page may reach its own origin, every https address, a Bee node on
  the viewer's own machine at any port, secure websockets for weeb-3, and the plain http addresses the
  image's settings name, as "What the page may reach" says. With `SWARM_ID_URL` set it may also frame
  that one site, for the hidden frame the Swarm ID library talks to and Swarm ID's button, and frame nothing else. Inline styles are allowed because the emoji picker writes its own, and blob URLs because the
  player plays through them, which is also why no gateway is named as a media source. Blob URLs are
  media, image and worker sources only, never a place the page connects to: hls.js reads a playlist
  with a request, so a stream card hands it its preview playlist from memory rather than as a blob.
- **The proxy passes reads only.** `/bee` forwards `GET` and `HEAD`, so the site cannot be used to
  write to the gateway. The chat writes through its own endpoint, `CHAT_WRITE_URL`.

## What the viewer does

- **The stream list.** Read from a Swarm feed and read again once a minute, also after a failed read,
  never on a longer backoff. Until the list has been shown from the source now selected, a failed read
  is tried again after 5 seconds, so a first read that fails, on load or after switching source, does
  not leave the page waiting a minute. Each read asks the list's next slot before it is written, and
  Bee skips each peer asked that early for a minute, so the page asks no more often than that. A new or changed entry therefore reaches an open browse page up
  to a minute after it is written. Once the list has been read, a slow or refused read of the next
  slot means nothing new yet, and a slot whose body does not parse is asked for again rather than
  skipped. Every live stream gets
  a featured block of its own, then the next upcoming stream, the soonest whose start is still ahead,
  gets one with a countdown in days, hours and minutes. The other upcoming streams follow as cards
  with the soonest start first, then the past streams newest first, eight to a page. The clock is
  read every 30 seconds, so a page left open moves its countdown and its feature on. A read from a
  newer feed slot replaces the list whatever changed in it, so an entry edited, unpublished or gone
  live in place shows on an open page without a reload.
- **Search.** The box above the list matches a stream's title, description and tags as the viewer
  types. While it holds a query the matches are one flat list, paged the same way, and a query that
  matches nothing says so.
- **Previews.** The entry's uploaded thumbnail when it has one, otherwise a frame decoded from the
  stream's first segment, with a live badge and the duration.
- **Scheduled streams.** An entry whose state is `scheduled` has been announced and not yet
  broadcast. Its watch page says the stream has not started and reads the broadcast's ladder markers,
  each period's marker once, about 4 seconds into the period. Each marker found prompts one read of the
  stream list, and the player starts once the list says live, with the stream's renditions. Apart from
  that the page reads the list once a minute, for a new start time, a title change or an unpublish,
  because asking the list's unwritten next slot more often makes the node skip its peers for that slot
  and the live entry then arrives up to a minute late. If it is unpublished while the page waits, the
  page says it is no longer available.
- **A broadcast that comes back.** After a feed finishes, the player keeps asking for the slot after
  the finished playlist, about every 30 seconds and spread per viewer. When the broadcast returns and
  the viewer has reached the end of what they were playing, the player rejoins it live.
- **Coming back to the page.** A phone that locks pauses the video, and Safari on an iPhone does not
  start it again on unlock. When the page is visible again on a live stream that is paused, playback
  starts again, and it catches up to live once the player has read the newest playlist. A pause the
  viewer made while watching, more than a second before the page was hidden, stays paused, a stream
  that is already playing is left to the player, and a recording is never touched. A pause the viewer
  makes while the page is hidden, from the lock screen's controls, by taking out earphones or with a
  media key, is undone when the page comes back.
- **The quality ladder.** A stream published in several qualities is one feed per quality plus a
  master playlist on a feed of its own. When the stream list names the stream's renditions, the
  player builds the master from the list and never reads the master feed. hls.js chooses the
  quality, and the player reads only the feed of the quality it plays. A stream turns live once its
  first quality has reported, so a viewer who joins a moment before the others report gets an entry
  naming only some of them, or none. The player compares the entry with the stream's time marker,
  the one it reads at the start anyway and then one per 10 second period for a minute, each address
  once. When a marker names a quality the entry lacks, the watch page reads the stream list's next slot
  once. A quality reports before its first segment, so that slot is written by then and the read is
  not early. The fuller entry rebuilds the player with every quality, which costs the viewer a moment
  of loading. The page never polls the list for this.
- **How far behind live it plays.** The live target is three segments of the playlist's segment
  length, never under 12 seconds, and moves when the playlist names a new length.
- **How it times its reads.** The player asks for the next playlist when it is due: the newest
  segment's end, plus one segment, plus a delay it learns from its own reads, set so that about one
  ask in four comes too early. A second ask covers that one, then one ask per segment, then asks
  every 2 seconds rising to 4 while nothing comes. A playlist 4 seconds late is looked past, one
  slot further on. One viewer costs about 40 reads a minute.
- **When the broadcast goes quiet.** Bee skips, for a minute, every peer it asked for an address not
  written yet, so a slot asked for over and over during an outage stays unreadable for about a minute
  after the broadcaster is back. So once the next slot has had five asks, the player stops asking for
  it and reads the stream's time markers instead (described below), each one once, 4 seconds into its
  10 seconds. When a marker names a slot past the missing one, the player reads that slot, whose
  playlist also holds the segments it skips, and follows on from there. The picture is back 4 to 14
  seconds after the broadcaster has new video, where it used to take about a minute. In a 10 second
  period whose marker is missing, the slot itself is asked once.
- **How it finds the newest playlist.** It reads slots by their number, never Bee's feed lookup.
  The uploader writes a time marker for each stream every 10 seconds, at an address worked out from
  the clock, naming every quality's newest playlist. At the start, at a switch, and when a quality
  stops or finishes, the player reads the marker of the previous 10 seconds, and the one before if
  that is missing, then one round of eight slots from where it says. One marker read serves every
  quality for a few seconds, and a marker address found missing is never asked again. The clock is
  the gateway's, taken from the `Date` header of every answer the Swarm client reads for the player and the stream list, so a viewer whose
  clock is wrong still finds the marker. With no marker, it searches as before: at the start eight slots at once,
  spread out to the feed's length, closing in on the newest in a few rounds, and at a switch from
  the playing quality's newest slot, usually one round. The new quality is read further back when the
  viewer is behind the live edge, at most ten reads, and the old one stops being read once hls.js has
  switched. When hls.js goes back to the old one before the new one plays, the new one stops instead.
  A switch asked before hls.js has reported its first quality is kept.
- **A quality that stops.** A quality is judged by its own progress, never by comparing it with
  another, because the qualities' feeds drift apart. A switch is refused to a quality that has
  finished while the playing one is live, and to one still open whose newest segment sits more than
  30 seconds behind the playing one's. When both have finished, as on a recording, no switch is
  refused, because every quality of a recording is complete whatever its dates say. When the playing
  quality has had nothing new for 8 seconds, or finishes, the next lower quality is found and then
  read for three of its segments, never under 6 seconds: if it moves on, the player moves to it and drops the stopped one. There is no limit
  on how many are dropped: a quality refused at a switch is dropped too, and the player keeps moving on
  until it is on a quality that moves. The last quality is never dropped. If the next one does not move
  on, the broadcast paused or ended, and the player says so.
- **The end.** The qualities of one broadcast finish moments apart, each as its upload drains. So
  when the playing quality finishes, the next lower one is watched for that whole bound rather than
  to its first new playlist: one that finishes inside them means the broadcast ended, and only one
  that carries on through them is moved to. A quality the player was moved to that finishes before
  hls.js has switched to it runs the same check.
- **A segment that will not load.** When hls.js gives up on one of the three newest segments of a
  live playlist (segments already marked as gaps not counted), the player marks that segment
  `#EXT-X-GAP` in the playlist it serves hls.js. hls.js gives up after its own retries with no other
  quality left to try, or at once on a segment it finds no media in. The video skips that segment's picture,
  about one segment long, instead of freezing or restarting the player, and every later reload of that playlist
  says the same. At most four segments of one stream are skipped this way in any five minutes, and a stream opened
  after another starts with all four. Past that, or for
  an older segment, a finished broadcast or a recording, the player handles the error as it always
  did: hls.js's own skip stands for a segment it gave up on, and a fatal network error restarts the
  player. A restart resumes a finished recording at the viewer's place, one segment further on each
  time the same segment keeps failing, and rejoins a live stream at the live edge. While another quality is left, a segment that failed to load is tried there instead and
  nothing is marked. The playback quality panel counts each skipped segment once, under Segments
  Skipped, and not as a fatal error or a reconnect attempt.
- **Where the video loads from.** My Swarm, the button in the header, is described below.
- **Moving the video keeps the place in a recording.** When the viewer picks another source for the video while a
  recording plays, the video carries on where it was, and stays paused if it was paused. Between two gateways or Bee
  nodes the same player keeps playing and only its source changes. A move to or from Weeb3 swaps this app's player for
  weeb-3's own, so the player being taken down records where the viewer was and whether they had paused
  (`src/features/player/placeAcrossSwap.ts`), and the new one starts there. Each recording keeps a place of its own
  while the watch page stays open, so a recording opened again from the same page starts where the viewer left it.
  This app's player asks hls.js to start at that place and keeps asking until its first segment is in, because hls.js
  forgets a start position it is given again before then, as the play that autoplay starts does. weeb-3's player
  starts at the beginning, since weeb-3 starts only there or live, and the video is moved to the place once weeb-3's
  rebuilt playlist reaches it. Measured on 2026-10-18 on a 1483 s recording, that playlist named 8 s at first and the
  whole length about 9 s later. Until then the video is held still and silent, every play weeb-3 starts is paused
  again, and the line under it says "Going to where you were in the recording", so the start of the recording never
  plays first. Once there, it plays from the place, or stays paused there if the viewer had paused. A viewer who
  leaves weeb-3 before it got there keeps the place they had. A live stream joins at its live edge in either player,
  as it always has, and a player that joined a broadcast live keeps no place for the next one, because its timeline
  starts where it joined.
- **Diagnosing playback.** `?qoe=1` on a watch page shows the playback quality panel, ported from
  Nandor Komlodi's panel in the streaming monorepo's client. Its round button toggles it, and so does
  `Q` when you are not typing in a field. The panel lives in the browser window, not in the player:
  drag the button to move it anywhere in the window, and drag any edge or corner to resize it like a
  window, down to 160 by 120 px. Moving and resizing need a mouse, a finger or a pen. The keyboard
  can focus the panel and scroll it, but moving or resizing it from the keyboard is not built yet. It
  opens 250 px wide at the player's top right. It is always kept inside the window with its header,
  or its button when collapsed, in reach, also after the window is resized and when full screen
  starts or ends. Where it was left, its size and whether it was open are remembered in this browser,
  and a place that no longer fits the window is pulled back in. It stays visible and usable in full
  screen: while the panel is on, the video's full screen button puts the whole player in full screen
  rather than the video alone, so the panel can be inside it. This was checked in Chromium only. A
  browser that refuses to move the full screen to the player keeps the video's own full screen, and
  the panel stays in the page, where it may be hidden or not take clicks. Safari on an iPhone always
  plays full screen in its own player, so the panel is not shown there. Copy puts what the panel
  shows on the clipboard as JSON, and Save downloads the same as `qoe-<stream>-<date>-<time>.json`,
  which works where a page served over plain http is refused the clipboard. A value not measured yet
  reads n/a, and a value out of range is marked with a `!` as well as its colour. The line under the
  header names the viewer's build, the same label Copy diagnostics names. `?level=720p` pins one
  quality, which tells a bad quality apart from a bad switch.

## My Swarm

The button at the right of the header opens My Swarm (`src/features/connect/Connect.tsx`), a panel at the side of
the window on a wider screen. The button says My Swarm, or the viewer's chat name with its badge once they chat.
My Swarm holds who the viewer is in the chat, every source they can read Swarm through, and what each source is
used for. Adding a source and a source's settings open in its place, with a back arrow. Escape goes back one view
the same way, and only Escape on the menu closes My Swarm. Each new view takes focus to its first field where it has
one, as the address of a gateway or a Bee node, and to its title otherwise. Closing My Swarm while Weeb3 is being
added asks first, since closing stops that node, with Keep adding and Stop and close. Every change applies at
once and is kept in the browser, and nothing switches a source by itself.

- **ID.** On a site with chat. Not chatting: a guest name with Chat as guest, and Sign in with Swarm ID where the
  deployment offers it, as [The chat](#the-chat) describes. Chatting: the name with its badge and Leave for a guest,
  or the Swarm ID account with Sign out, and the theme switcher where the deployment allows it. Leave asks first,
  since it forgets the name. The chat's own join button opens My Swarm too.
- **Swarm access.** One list of every source: the gateways `config.json` offers, marked Offered, then the ones the
  viewer added. Each row has a status dot, the name, its kind and address, how long its last light check took, and a
  Settings button. While My Swarm is open each source gets that light check about every 10 s, the stream list's
  first entry for a gateway and Bee's `/health`, `/readiness` and `/peers` for a Bee node, and nothing is checked
  while it is closed. Add source sits under the list.
- **Use for.** All features reads the video, the stream list, the previews and the chat history from the one source
  picked. Per feature picks a source each for Video, Stream list, Previews and Chat history. While the event pays, chat
  messages are sent to `chat.writeUrl`, whichever source reads the chat history. On the viewer's own stamp they go
  through the source picked for Chat history, a Bee node of their own or Weeb3. The deployment's default gateway reads its chat
  history at `chat.readUrl`, where it serves the chat's paths, and any other source reads the chat at its own address.
  A part saved on a source the deployment no longer offers is read from the deployment's default source when the
  page loads, and so is one saved on a source the viewer removed.
- **Adding a source.** Three tiles: Gateway, a Swarm gateway at an https address, My Bee node, on this computer or
  at an https address, and Weeb3, a Swarm node in this browser tab. A browser has one Bee node of its own and one
  Weeb3, so each tile says Already added once it is. A gateway or a Bee node takes an address and a name, and Test
  connection runs its checks (below). The add button stays disabled until every check passed for the address in the
  field, so nothing is added before, and a new address asks for the checks again. A source that was added is not put
  in use: the viewer picks it under Use for.
- **Weeb3.** Opening its tile starts the node and shows its download, against the 2.2 MB module, and its peers out of
  200, the healthy target, with "Playback can start before that." Its checks run at once, and Add Weeb3 waits for
  them. When they did not pass, Test again runs them once more, and starts the node again first if it failed. Use for offers it for all features and for every part, as any
  other source: the video, the stream list, the previews and the chat history then read through it and through
  nothing else. While a part waits for it to start, the browse page under "Looking for streams..." and the chat
  under "Loading the chat…" say how far it has got, in the words its row uses. Its row shows how far the node has got: the download, then "Starting", "Connecting, N of 200
  peers", and once ready "N of 200 peers", or "Failed to start".
- **The checks.** Each kind runs its own, in this order, each line with ✓, ✕ or – and its time. The first that fails
  stops the rest, which show –, and a box under them says what is wrong and what to fix, such as "Not added. It does
  not allow this site (CORS)." and "Its operator has to add this site to Bee's cors-allowed-origins." For a Bee node
  of the viewer's own that box also gives the exact `cors-allowed-origins` lines for this page's origin, or how to
  undo a refusal of the browser's local network question (`src/features/gateway/sourceChecks.ts`, its words in
  `checkWords.ts`).

  | Check                                            | Kind         | How it is measured                                                                                                       |
  | ------------------------------------------------ | ------------ | ------------------------------------------------------------------------------------------------------------------------ |
  | Answers over https                               | gateway      | The address is https, or on this computer, and the stream list's first entry is asked. Any answer is one                 |
  | Answers, on this computer or at an https address | Bee node     | The address is on this computer or https, then the same read                                                             |
  | Allows this site (CORS)                          | gateway, Bee | That answer could be read by this page. A refusal is told from nothing there by a second request without CORS            |
  | Bee 2.6 or later                                 | gateway      | `/health`'s version. A gateway that does not state one passes with "not stated", one that states an older release fails  |
  | Bee 2.6 or later, ready                          | Bee node     | `/health`'s version, `/readiness` and `/peers`, so a node still starting or with no peers fails                          |
  | Node started                                     | Weeb3        | Its module downloaded and the node running, waited for as long as its own deadlines allow                                |
  | Connected to 20 peers                            | Weeb3        | Its peer count, waited for up to a minute                                                                                |
  | Reads a chunk                                    | every kind   | The root chunk of a segment of this event's video, read the way the chat history reads its slots, through its chat route |
  | Reads bytes                                      | every kind   | The same segment's bytes, read the way the player reads it                                                               |
  | Reads this event's stream list                   | every kind   | The feed's head, parsed as a stream list, then its entry by index, as the player reads a playlist. Weeb3 below           |

  The segment comes from the stream list the page shows, a live stream first, else the newest with video, and its
  playlist is found as the player finds it. A stream's picture stands in where no stream has video yet. A gateway or
  a Bee node then reads the entry its stream list head names by that index, the read the player opens every playlist
  with, so one that serves feed heads and no feed entry, by `/soc` or by chunk address, fails there. Weeb3's head
  search costs a few 17 s misses, so its stream list check reads the newest entry the page already read by that
  entry's index, one read of the same body the browse page reads. It searches for the head when the page has not
  read the list, and when that entry is not on the node yet, as right after a gateway ahead of it served a new list.

- **A source's settings.** Its name and address, Test connection, which runs the same checks again, and the last
  light check's time until then. A source the event offers says "Offered by this event. It cannot be changed or
  removed." and its fields are read only. An added source's name can be changed, its address cannot, and Remove takes
  it out, every part that read from it moving to the default gateway. Weeb3's settings show its peers, its network
  and the weeb-3 build, and its Test connection starts a node that failed once more. Copy diagnostics is there for
  every source.
- **No fallback.** A part reads from the source picked for it and from nothing else, whatever that source answers.
  The player's own retries ask the same source again. A switch under Use for takes effect at once, so the video's next
  segment comes from the new source, in a recording as in a live stream.
- **A source that fails.** When a part's reads, or the segments and pictures loaded for it, have had no answer it can use for 10 s, a bar under the header says
  so, such as "Video cannot load from Event gateway." and "No answer for more than 10 s.", with a Choose another source button
  that opens My Swarm. One bar per failing part, gone at the part's next answer, or 30 s after it stopped reading. A not
  found is an answer, so a chat slot not written yet never shows one. The watch page names the video's source above
  the player, such as "via Event gateway".
- **Copy diagnostics.** The last checks of that source, who answered each part in the last minute, the build and the
  browser. The build is named by its release tag and short commit, such as `v1.7.0-rc.5 (1fcfbd4)`, as "The release
  tag and the build label" under "Run the image" says. It holds no address but the checked source's.

What the browser keeps, in `localStorage`, every read and write guarded so a refusal leaves the
deployment's defaults for that visit:

| Key                                        | What it holds                                                                                                |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------ |
| `swarm-sources`                            | The sources the viewer added: id, type (`gateway`, `bee-node` or `weeb-3`), name, address, none for `weeb-3` |
| `swarm-routing`                            | All features or per feature, the source picked, and each part's source                                       |
| `viewer-theme`                             | The theme a viewer picked with the theme switcher, kept after a logout                                       |
| `stream-event-client:chat-session`         | A guest's chat login: the display name, the chat key this browser made for them, and its address             |
| `stream-event-client:chat-stamp:<address>` | Per account, by its chat address on this site: whether the gateway or their own stamp pays                   |
| `stream-event-client:qoe-panel.v1`         | Where the playback quality panel (`?qoe=1`) sits, its size, and whether it is open                           |

The Swarm ID sign-in is not among these. The Swarm ID library keeps what it needs for it, which this list does not
cover.

## The node in this browser (weeb-3)

weeb-3 (`@lat-murmeldjur/weeb_3`) is a Swarm node compiled to WebAssembly that runs inside the viewer's tab, so a
viewer can watch, browse and read the chat without any gateway. A page runs one node, behind a shared worker, and everything that uses weeb-3
shares it (`src/swarm/providers/weeb-3/weeb3Runtime.ts`). It is ready once it has a peer and its service worker
controls the page, and counts as failed when it is not ready after 30 s.

- **Loaded only when picked.** The package is imported from one module, `weeb3Module.ts`, as a chunk of its own,
  so the first page load carries none of it. The build copies the package's browser files, its service worker,
  shared worker and WebAssembly module, to `/weeb-3/` (`scripts/weeb3-files.mjs`). The bundle carries no copy of
  the module of its own.
- **When it runs.** The node runs while something holds it: every part while weeb-3 is that part's source, the watch
  page's player while it shows, My Swarm from adding it until My Swarm closes, or a source's settings while it is
  checked there, and every read through it while that read runs. A read made while the node is starting waits for it to be
  ready, and one made while it is stopped starts it first, so a part never gets an early answer from a node that is
  not there yet. A node that fails to start answers the read as unavailable. Listing a saved one starts
  nothing. When the last of them lets go, as when every part moves to another source or the source is removed, the
  node is stopped and freed. The watch page's player lets go of the node and also stops weeb-3's player for its video,
  so a video the viewer has left loads nothing more through weeb-3.
- **Getting ready.** The page downloads the 2.2 MB WebAssembly module itself, reading it as it streams, so the
  row in My Swarm and the watch page can show how much has arrived against the length the server names. A
  download that has not finished after 60 s, or whose package fails to load, is stopped and the node counts as
  failed. It hands the bytes to the package, then reports starting, then connecting with its peers counted against 200,
  weeb-3's own connection target (`CONNECTION_BUILDUP_LIMIT` in its `src/accounting.rs`, which its project README
  says drops to four fifths for every 100 lost connections, down to 30). The node is ready at its first peer, so
  the video does not wait for the rest, and the count keeps building up after that.
- **A node that lost its peers.** Once ready, the node's peers are read every half second. When every read for
  20 s finds no peers or throws, as after a phone locked the tab, the node is lost
  (`WEEB3_LOST_AFTER_MS`). A shorter dip, such as a network handover, leaves it ready. My Swarm's row says "Lost
  its peers", its settings say Test connection starts it again, and the line on the watch page adds "Open My Swarm to
  start it again." While it is lost, every read through it is unavailable at once, and a message pushed through it
  fails at once with "The Swarm node in this browser lost its peers. Open My Swarm to start it again." Nothing starts
  it again by itself and nothing switches to another source: Test connection in its settings, or Test again while
  adding it, starts a new node in its place, which is ready again at its first peer.
- **The video, in weeb-3's own player.** With weeb-3 as the video's source the watch page plays the stream with
  weeb-3's player, bare: a video element with the browser's controls, from the
  newest entry for a live stream and the beginning for a finished one, and none of this app's overlays or `?level=`.
  The quality menu weeb-3 adds beside its video is hidden, and its player, which starts held at the highest
  quality, is set to choose its quality itself once the stream is attached, as this app's own player does. One quiet line under the player, never over the video,
  shows the download, then the peers out of 200 with the same note under 200, until the node is ready, and says
  so again if it loses its peers. The stream is attached once the node is ready. Nothing replaces weeb-3's player: one whose node fails, or that cannot attach, says "The Swarm node in this browser could not play this stream." and stays. weeb-3's limits
  are its own: it plays about 16 s behind live, does not leave a quality that stopped, does not notice a broadcast
  that returns, and plays one stream across the browser's tabs.
- **Leaving weeb-3's player stops it.** weeb-3 names no way to stop its player, which is hls.js underneath and would
  keep loading segments, up to three minutes ahead for a finished stream, for a video the viewer has left. So the
  build hands weeb-3's own import of hls.js the app's copy with its player class made stoppable
  (`src/swarm/providers/weeb-3/weeb3Hls.ts`, pointed at by `scripts/weeb3-files.mjs`), which records each player by
  the video it plays into. When the watch page stops showing weeb-3's player, because the video moves to another
  source, the viewer leaves the page or picks another stream, the player for that video is stopped and destroyed, and
  nothing weeb-3 calls on it afterwards loads again, nor does a new player weeb-3 makes for that video, until the page
  plays a stream into it again. The video itself is then paused and emptied, which stops the download in a browser
  that plays HLS natively, as Safari does without Media Source Extensions, where weeb-3 uses no hls.js and there is
  no player to stop. So both cases are covered: an hls.js player is stopped and destroyed, and a native one stops
  with its emptied video. The stoppable copy of hls.js is a small chunk of its own, loaded only by weeb-3's chunk, so the first
  page load still carries none of weeb-3. The dev server's dependency bundler leaves the package out, so the dev
  server makes the same switch.
- **No switching.** A part that reads from weeb-3 reads from it alone, as every part reads from its own source alone.
  None of its reads is handed to another source whatever it answers. Every read through it gets weeb-3's
  own 30 s budget rather than the client's 10 s, so a missing chunk, which weeb-3 gives up on after about 17 s, ends
  as not found rather than cut short. A stream list that cannot be read names its source on the browse page, as
  every source's does: "Stream list cannot load from Weeb3. Open My Swarm to check it, or pick another source."
- **Reads.** weeb-3 reads through its service worker's routes: `/weeb-3/chunks/` for a chunk, a feed entry or a
  single-owner chunk, `/weeb-3/bytes/` for bytes, and segment URLs on its caching route `/weeb-3/hls/bytes/`. weeb-3
  puts a chunk's 8-byte span before bytes and before a single-owner chunk's payload, which Bee leaves out, so it is
  taken off. A feed entry or a single-owner chunk whose body is longer than one chunk's 4 KB, such as a stream list of
  more than a few dozen streams, wraps the root of a tree of chunks, and weeb-3 answers it with the root's own
  payload, the addresses of the chunks below it, where Bee joins the body. So when the span says the body is longer
  than the payload, the body is read whole from `/weeb-3/bytes/` at the root's address, and a body that is not the
  length the span names answers unavailable. A body uploaded with erasure coding keeps its redundancy level in the top
  byte of its root's span, as 0x80 plus the level, so a span whose top byte is above 0x80 names the length in its
  lower 7 bytes (`src/swarm/chunkSpan.ts`, as Bee's own `redundancy.DecodeSpan` reads it). The root's address is still
  made over the span as stored. Read whole, such a span names a body of about 9.3e18 bytes, which no joined body
  matches. The chat's slots, read through Weeb3 or through a gateway, take their length the same way. A feed's head,
  which weeb-3 has no lookup for, is found by reading the feed's entries by index, eight at a time: entry 0 and every
  power of four less one, then wider steps past the newest entry found until one misses, then even cuts of the gap
  until the newest entry and the missing one above it touch. A miss costs weeb-3 about 17 s, so a head read takes a
  few of those, about a minute for a feed of a few hundred entries, and the answer it gives is always an entry read
  with the one above it read missing. A later head read of the same feed starts from the head found before, reading it
  and the five entries above it at once, so a polled chat, stream list or own feed that gained up to four entries
  costs one round. When the head found before is missing, the head went back below it, and the search starts again
  from scratch rather than keep the old one. A single-owner chunk comes back as the chunk it wraps, without the
  identifier and signature that prove it the owner's, so a read of one by its address answers unsupported, and
  plainly. The chat reads its slots, its notes and a sender's own copies by the owner and the identifier instead
  (`readUnsignedSoc`), and takes weeb-3's word for whose chunk it is (`src/features/chat/ownersChunk.ts`). Every
  message is still checked against its sender's signature, so such a chunk can at most carry a message somebody
  signed, never one in another's name.
- **Stopping, as far as it goes.** Stopping frees the page's handle on the node, and with 0.0.354001 that leaves the
  node in the package's shared worker running: a handle made after a stop still finds its peers. The package names
  no way to stop that worker's node, so it lasts until the browser closes the worker with the tab. Its player in the
  page is another matter: the app stops that one itself when the viewer leaves it, as "Leaving weeb-3's player stops
  it" above says.
- **The live proof.** `pnpm proof:weeb3` builds the app and, on the public Swarm network, adds the node in a real
  browser, picks it for the video, waits for it to be ready, plays a finished stream from its beginning, checks that
  `/weeb-3/bytes/` carries exactly the 8-byte span `/weeb-3/hls/bytes/` leaves out, and asks the shared worker for
  its peers after the stop. It prints what it saw and is never part of `pnpm e2e`. Its default stream is a public
  test stream run by weeb-3's author, and `WEEB3_PROOF_OWNER` and `WEEB3_PROOF_TOPIC` name another.

## How the player reads Swarm

hls.js expects playlists at fixed URLs. On Swarm every playlist update is new content under a feed,
so the player brings its own loaders:

- **CustomManifestLoader** reads the latest playlist from its feed instead of a fixed URL. Every feed
  read the player makes goes through the Swarm client's player reader, which `AppProvider` hands the
  shared `ManifestFetcher` at start and on every node switch (`useSwarm`). Not found is a slot not
  written yet, and anything else is the gateway failing, backed off as before, a rate limit for at
  least as long as it asked.
- **CustomFragmentLoader** hands each segment to hls.js's own loader, staggered by a bounded random
  delay so a crowd at the live edge does not ask in the same instant. Segments, preview segments and
  stream pictures are loaded by hls.js and the browser from the URLs the client gives (`urlFor`),
  written into the playlist or the page, not read through the client. Each load's outcome is still
  reported to the client (`reportUrlLoad`): a segment hls.js loads or fails for the video, and a preview
  segment or a picture for the previews, so a source that serves feeds and fails every segment shows the
  failure bar. A failed one is asked again of the same source by hls.js. `fetchSegmentBytes` is the one place segment
  bytes are fetched, where a provider without URLs can plug in. It loads a segment from the source the video reads from
  at that moment. hls.js keeps the URLs it was given, for good in a recording, whose playlist is read only once, so
  the loader names each segment the player named again by the current source before it goes out
  (`ManifestFetcher.segmentUrlNow`), for a live stream as for a recording. A viewer who switches Video to another
  gateway or to their own Bee node therefore gets the next segment from the new source, and its load counts against
  that source.
  A URL the player did not name goes out as given: a preview's segment, and a recording published before
  2026-08-13 whose manifest names its publisher's gateway.
- **ManifestStateManager** merges each live playlist into a growing EVENT playlist, so segments stay
  playable longer than the publisher's sliding window.
- **LadderFeedPoller** follows the feed of the quality hls.js plays, plus the one being switched to
  during a switch. A quality left behind forgets where it was, so coming back to it starts at its
  newest playlist. Where it starts comes from a `NewestIndexFinder`, injected so it can be swapped:
  the `MarkerFinder`, which reads the ladder's time marker (`src/shared/ladderMarker.ts`, copied from
  the uploader) and falls back to the `IndexSearchFinder`. How it follows is `followPredicted` in
  `src/features/player/following/`, the polling study's choice. The player assumes no segment length:
  the follower and the searches take it from the `#EXTINF` values of the playlist they stand on, and a
  join from a time marker takes the `segmentMs` the marker names, which is the stage's `HLS_FRAGMENT`. The study's simulator and the strategies it was compared with are in `test/feedModel/`.
- **A quality's first playlist** is waited for 20 s, the poller's 15 s search and 5 s more, and then
  that quality is failed so hls.js tries another, because a gateway that does not hold a quality never
  answers for it.
- **A slow source.** The `ManifestFetcher` times how long the source it reads from takes to answer that
  a slot is not there, over the latest 16 such answers (`src/features/player/sourceMissCost.ts`). Once
  five have been answered, the source is slow when the middle one of them is over 3 s. Before that it
  is slow only when at least two answers were all over 3 s, so one slow first answer on a cold
  connection does not make a fast gateway slow. A freshly started light Bee node with no
  blockchain took 6 to 10 s, where a full node takes 1.3 to 1.6 s. On a slow source a search round is
  taken to last one and a half of those answers. A read is given two rounds instead of the usual 10 s,
  and a quality's first playlist is waited for eight rounds and 5 s more instead of 20 s, both capped,
  at 30 s and at about two minutes. The player keeps reading from the source picked for it and never
  switches to another, and it makes no read more often than before. Until the first picture it says
  "This Swarm source answers slowly, so the video takes longer to start". On a source that is not slow
  nothing changes. On such a node the video can still stall after it starts: measured on 2026-10-18,
  a segment took 2 to 5 s to load and hls.js gave one up at its own 10 s, and each switch of quality
  costs another search of about a minute. A failover to another quality cannot succeed there either,
  because the search of the quality tried keeps its fixed 15 s bound.

Feed URIs use a `swarm://<owner>/<topic>` scheme, because hls.js resolves every playlist URI against
the playlist's own URL and a URI with a scheme is the one case it leaves untouched.

## The Swarm client

`src/swarm/` is the one layer that reads Swarm, plain TypeScript with no React, and it imports nothing
from `src/app` or `src/features`. The features and the app read only through it: a test fails on a line
there that builds a Bee URL, calls fetch, or makes a Bee client of its own, and on an import of anything
in `src/swarm` beyond the client's public surface, `client`, `answers`, `provider`, `settings`,
`createSwarmClient`, `addressSpace`, `sources` and `routing` (`test/swarm/boundary.test.ts`). Seven imports past
it are named exceptions, each with its reason in the test: the event chat write (`providers/bee-http/gsocWrite`)
and the single-owner chunk codec (`singleOwnerChunk`) in `chatParts.ts`, the codec again in `ownersChunk.ts`, the
own-stamp write to a Bee node (`providers/bee-http/stampedSocUpload`) in `ownStampWrite.ts`, the push through
Weeb3 (`providers/weeb-3/weeb3Push`) in `ChatStamp.tsx`, and the errors of both, read in `stampProblems.ts`.

- **Where each feature reads.** `AppProvider` makes one client at start from `config.json` and the
  viewer's saved sources, and makes it again when the viewer changes what a part reads from.
  Components get it from the app
  context. The player reads through `reader('player')`, the stream list through `reader('stream-list')`,
  the previews and pictures through `reader('previews')`, My Swarm checks a source through a
  client made for that source alone, and the chat reads through `reader('chat')`, on the source picked for the
  chat history.
- **The chat.** swarm-chat-js 8.1.0 is handed a source and a write in place of its own Bee client
  (`src/features/chat/chatParts.ts`). The source makes the library's own reads at the same URLs: the
  feed head, each slot and note as a single-owner chunk checked to be the chat owner's
  (`src/swarm/singleOwnerChunk.ts`), or through the node in this browser by its owner and identifier, and history
  files as bytes. A 404 and a 500 both mean a chunk is
  not there, as the library rules. While the event pays, a message is written exactly as the library writes it,
  to `chat.writeUrl`, whose gateway stamps it. On the viewer's own stamp, Swarm ID stamps it and the page sends it
  through the source picked for Chat history, the viewer's Bee node or Weeb3, as
  [Who pays for a message](#who-pays-for-a-message) says.

- **A provider** is one way of reaching Swarm (`src/swarm/provider.ts`), holding only what the app reads:
  a feed's head, a feed entry by index, a single-owner chunk's payload by its owner and identifier (a
  feed entry is one, and so is a ladder's time marker), a chunk, the bytes a reference names, and a URL
  for what the browser or hls.js loads itself. It also has its status, a probe, and start and stop
  for a node in the tab. `src/swarm/providers/bee-http/` is Bee's HTTP API, asking the paths the app has
  always asked. Public gateways such as `api.gateway.ethswarm.org` and `bzz.limo` refuse `/soc` at their front
  door, with a plain-text `Not Found` where Bee answers every 404 as JSON, and serve the same chunk at
  `/chunks/<address>`. So a 404 on `/soc` that is not Bee's JSON makes the provider read that single-owner chunk by
  its address, and every later one there first. It checks the chunk is the owner's, its signature recovering the
  owner who with the identifier makes the address asked, and joins a body longer than one chunk from `/bytes` at
  the root it wraps, as `/soc` does. Bee's own JSON 404 stays not found and asks nothing more, so a gateway that
  serves `/soc`, the event gateway among them, pays no extra request for a slot not written yet. When the chunk
  address is refused as well, the read is unavailable with that 404, and the next one asks `/soc` again.
- **Every read answers and never throws** (`src/swarm/answers.ts`): the content, with the feed index
  and the server time where the answer carries them, not found, rate limited with the wait asked for,
  unsupported, unavailable with its cause (a timeout, a status or no answer at all), or aborted. Every
  read takes a signal and a window, ten seconds when none is given. Bee's 404 is not found, its 429 is
  rate limited with its `Retry-After` capped at a minute, and any other failing status, a 500 included,
  is unavailable. A chunk read is the exception: Bee answers 500 for a chat slot never written, which an
  idle chat asks for on every poll, so there a 500 is not found.
- **The client** (`src/swarm/client.ts`) is made from the settings and the viewer's choice by
  `createSwarmClient`, which makes each gateway's provider through the registry of kinds
  (`src/swarm/registry.ts`). Each feature (the player, the stream list, the previews, the chat) reads
  through its own provider and through nothing else. A read that fails answers as it failed, and the
  feature's own retry, such as the player's backoff, asks the same provider again. URLs come from the
  feature's own provider, and a segment URL the player already holds is named again by the new source at
  a switch of node, as each segment is loaded, for a live stream as for a recording. Every read is counted
  by feature, kind, provider and answer, and `activity()` gives the last minute's answers per feature,
  which the diagnostics carry. The server time of the player's and the
  stream list's answers keeps the gateway clock, and the chat's, read from the chat's own host, does not.
- **The contract** (`test/swarm/providerContract.ts`) is the suite every provider kind must pass, run
  for Bee over HTTP against the answers the browser smoke test replays.

## The design

Two themes. `swarm` is Swarm Brand v3.0 as msrs-client's Swarm theme draws it: near-black surfaces, the
Swarm orange `#f47a20` as a sparing accent and Geist for all text. `web3privacy` is web3privacy.info's: a
black page, the neon green `#70ff88`, Archivo for text and Domine for headings. Both use JetBrains Mono
only for the configuration problem's detail and the playback quality panel. A deployment picks its
theme in `config.json`, and a logged-in viewer can switch the look, as above.

- **The tokens.** The scales (sizes, spacing, type steps, radii, timing) live in
  `src/design/_tokens.scss`, one Sass map per group. What a theme decides, its colours and typefaces,
  lives in `src/design/themes/`, one file per theme, each merged over `themes/_base.scss`, which holds
  what every theme shares. `src/design/theme.scss` emits the scales once on `:root` and each theme under
  `:root[data-theme='<name>']`, the default theme on a bare `:root` too, and under
  `[data-theme-preview='<name>']` for an element that shows one theme whatever the page wears,
  as CSS custom properties named `--<group>-<name>`, for example `--color-primary` or
  `--spacing-base`. It also sets the page's base styles.
- **Components read only the variables**, `var(--color-primary)`, never a Sass token or a literal
  colour, so a switch of the look reaches every part of the page. The tokens test refuses a colour a
  stylesheet outside `src/design/` writes out. The breakpoints are the one exception, because a media query cannot read a custom
  property: they are the mixins in `src/design/_media.scss`, and every layout is written for a phone
  first and widened by them.
- **To add a token**, add a scale to its map in `_tokens.scss`, or a colour or typeface to every
  theme in `src/design/themes/`, and read it where it is needed. The tokens test
  (`test/designTokens.test.ts`) fails when a stylesheet reads a variable the design does not define,
  when the design defines one nothing reads, when one theme lacks a variable another has, and when a
  text colour falls below 4.5:1 against its background. A new colour pairing goes into its list too.
- **The fonts** are bundled from `@fontsource`, only the weights used: Geist 400, 500, 600 and 700,
  Archivo 300 to 700, Domine 400 and JetBrains Mono 500, imported in `src/design/fonts.ts`. A browser
  downloads a typeface only when text on the page is set in it, which the switcher's swatches do for each
  theme's heading typeface once the menu is open. The page makes no font request to a
  third party. Another weight needs its file imported there, or the browser fakes it.

## Layout

```
src/
  app/          the entry, routes, the app provider, the page layout and header
  config/       the runtime configuration, read and checked at start
  design/       the design tokens, the themes' looks and content, the fonts and the logos
  features/
    catalog/    the stream list: feed reader, schema, polling, previews
    player/     the Swarm HLS player, its loaders and overlays, the watch page
    connect/    My Swarm, the panel the header opens: the ID, the sources, Use for, and the failure bar
    gateway/    a source's checks, its light status, the address rules and the diagnostics
    chat/       the chat panel, the display-name login, the chat library's lifecycle
  swarm/        the Swarm client, its providers and their answers, and the settings it is made from
  shared/       the stream list format and feed helpers copied from streaming-monorepo, the fetch
                helpers every feature uses, and the components more than one feature uses
test/           the unit tests, test/shared for the copied modules, test/chat for the chat against a
                stand-in for the chat library
```

The files in `src/shared` that came from streaming-monorepo name the path and commit they were
copied from. Refresh them from there when the stream list format changes. The chat in
`src/features/chat` started as a copy of msrs-client's at `a2f50151`, and has been rebuilt since.

## Licence

MIT, see [LICENSE](LICENSE).
