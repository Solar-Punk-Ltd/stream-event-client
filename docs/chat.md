# The chat

Every stream has a chat beside it, and this page says how it works: what a viewer can do in it, what it needs outside
this repository, how it reads and writes Swarm, and how every message is checked before it is shown. The chat sits
beside the video on a desktop and under it on a phone, where it folds away. It is optional: without a `chat` block in
`config.json`, or with `enabled` false, nothing of it is on the page ([configuration](configuration.md#the-chat-block)).
The code is `src/features/chat/`, and the library under it is `@solarpunkltd/swarm-chat-js` 10.0.0.

Words used here, such as slot, part and Use for, are explained in
[the glossary](handover/stack.md#words-used-across-these-docs).

Anyone can read it. Writing asks once for a display name, 1 to 20 characters with no invisible formatting or control
character such as a right-to-left override. The zero width joiner and non-joiner are allowed, since joined emoji and
Persian or Indic names need them. A name ending in .eth, in any case or with lookalike letters or dots such as the
fullwidth ones, is refused with "Names ending in .eth are kept for ENS names.", since only a verified ENS name shows as
one. There is no password, wallet or account. A deployment that names a Swarm ID site in `swarmId.url` also offers
signing in with Swarm ID, described in [Swarm ID](swarm-id.md).

A viewer can send a message, react with an emoji, reply in a thread, load older messages, and retry a message that did
not send.

- A message lights up under the pointer and shows its reaction and reply buttons there, as keyboard focus inside it
  does, and on a touch screen a tap shows them.
- A mouse click never keeps them, so a click on the sender's badge opens the details and nothing else.
- The emoji bar's last button opens every emoji above the field, with its close button above the picker.
- While the message field has focus and a phone's keyboard is up, it comes back into view whenever the page or the part
  of it the keyboard leaves visible changes size, so the keyboard never covers what is being typed. With the keyboard
  closed, a viewer who scrolls away from a field that kept its focus is left where they scrolled
  (`MessageSender/useFieldStaysInView.ts`).

The chat and its library are a file of the bundle of their own, fetched as the watch page opens, beside the video
rather than after it (`src/features/chat/WatchChat.tsx` lazy-loads `Chat/Chat.tsx`). The emoji picker is fetched the
first time one is drawn: the emoji bar above the message field, or a reaction's picker beside a message.

## What it needs, outside this repository

Two services, set up apart from this app:

- **Two Bee endpoints for the chat.** `chat.readUrl` serves the chat's feed and history files. `chat.writeUrl` takes
  the messages and stamps every write, because the page holds no stamp key. A message costs one stamped chunk, and
  one more for each resend while it has not been read back. A viewer who pays with their own stamp,
  [who pays for a message](own-stamp.md), sends through their own Bee node or through Weeb3 instead.
- **The chat aggregator**, on swarm-chat-js 9. It listens on the shared chat address made from `gsocResourceId` and
  `gsocTopic`, and appends each message to the stream's chat feed, `chat-<stream topic>` under `chat.feedOwner`.
  - Opening a chat reads the newest history file the chat feed points to, then the entries after it.
  - When the feed's newest entry is not found in time, the library opens the chat empty and reads on from its first
    entry, and the chat says "Loading the chat…" until that read answers. "No messages yet." shows only once it found
    nothing.
  - The endpoint viewers write through must be a different Bee node from the one the aggregator listens on, because
    Bee hands a message on to a listener only when it arrives from another node.

The per-stream settings the library is started with are built by `chatSettings` in `src/features/chat/chatSettings.ts`:
the chat topic `chat-<stream topic>`, a read-only key for a reader with no name, `chat.readUrl` as the library's Bee
address, and `chat.writeUrl` as the write address while the gateway pays. The library's own timeouts are set there too.

## Why `gsocResourceId` is not a secret

`gsocResourceId` is the key every viewer's page uses to write to the shared chat address. Every viewer writes to the
same address, so every viewer's page carries the same key. It is chosen so the address lands where the aggregator
listens, and it owns nothing but that shared chat address, which every viewer writes to anyway. A check for keys in
the tree has to know it.

## How the chat reads Swarm

The library is handed a source and a write in place of its own Bee client (`src/features/chat/chatParts.ts`).

- The source makes the library's own reads through the Swarm client's chat reader, `reader('chat')`, on the source
  picked for Chat history in My Swarm: the feed head, each slot and note as a single-owner chunk checked to be the chat
  owner's (`src/swarm/singleOwnerChunk.ts`), or through the node in this browser by its owner and identifier, and
  history files as bytes.
- A 404 and a 500 both mean a chunk is not there, as the library rules.
- While the event pays, a message is written exactly as the library writes it, to `chat.writeUrl`, whose gateway stamps
  it. On the viewer's own stamp, Swarm ID stamps it and the page sends it through the viewer's Bee node or Weeb3, as
  [who pays](own-stamp.md) says.

## What the browser keeps

A guest's display name, the chat key made for it (32 random bytes from the browser's own crypto) and its address sit
in local storage under `stream-event-client:chat-session` (`src/features/chat/auth/persistence.ts`), so a reload keeps
the name. Logging out, or Leave beside Swarm ID, removes them. The guest's key proves only that two messages came from
the same browser, and anyone may choose any name. So the badge beside a guest's name opens the details, where the
sender's full public address tells apart two people who chose the same name.

Nothing of a Swarm ID sign-in is kept there. What a Swarm ID account picked for paying, the gateway or its own stamp,
sits under `stream-event-client:chat-stamp:<its chat address>` (`src/features/chat/stamp/chatStampChoice.ts`), one entry
per account, so another account signing in on the same browser starts with the gateway paying.

## What the chat checks, and the badges

Every message is signed by its sender's chat key. The page checks each one, live, from history and the viewer's own
while it is still sending, in a Web Worker with swarm-chat-js's `verifyChatMessage` and the page's own origin, so a
long history never holds up the page (`src/features/chat/verify/`).

- History is checked in batches of 25, and each batch shows as soon as it passed. A message is shown only once it
  passed.
- One that fails, whether its text was changed after signing, its Swarm ID binding was made for another site, or it is
  in the format before version 8, is never shown, and the panel counts them in its `data-refused-messages` attribute.
  A chat whose history is all of the older format opens as an empty chat.
- The worker is the bundle's own file, so the page's policy allows it with `worker-src 'self'`. A worker that cannot
  start or fails is left, and the same check runs on the page's thread instead, for the messages it held and every
  later one. Nothing is shown unchecked and nothing is left waiting.

A signature stops anyone from forging a message, never from withholding one. The chat server that writes the chat feed
decides which messages are in it and in what order, and the endpoints the page reads through decide what reaches it.
Who else a viewer trusts is in [what a viewer has to trust](../README.md#what-a-viewer-has-to-trust).

Above each message is its sender line: the name, the badge, the stamp for a message sent with the sender's own stamp,
and the time it was published, in hours and minutes on the viewer's clock. There is no initial and nothing floats over
the row.

- A grey outline hexagon after a name in the plain weight is a guest, told apart only by the key their browser keeps.
- A filled hexagon with a check after a name in the accent colour is a Swarm ID account, which signed a statement that
  this chat address on this site is its own. The badge shows that an account key signed that statement. Anyone can make
  such a key, so the badge tells accounts apart and does not vouch for a person or for a genuine Swarm ID account.
- A stamp after the badge says the sender paid for the write with a stamp of their own. Every message this page sends
  says who paid, the event gateway or the viewer's own stamp.

## A message's details, and Verify

The badge, and the stamp where there is one, open the message's details, across the chat column: the name with its
badge, the identity (Guest or Swarm ID), the public chat address, a check mark for a signature that matches the text,
for a Swarm ID the account's address, and who paid for the write (Event gateway or Own stamp). An address shows short,
`0x0d7f…ab12`, and a press shows it in full with a Copy button beside it, which reads Copied for three seconds after a
copy, and a screen reader hears that the copy worked. A press on the check mark shows the signature the same way.

For a message sent with its sender's own stamp, the details also show the sender's own feed, `ownFeedTopic(chatTopic)`
under their chat address, as **Own feed: a1b2…c3d4/5e6f…7a8b**, its owner and topic short, with a Copy button that
copies both in full as `owner/topic`. Opening the details reads nothing more.

A **Verify** button compares the own feed with the chat only when pressed, and says **Checked 12 of 40** while it
reads, counting the entries of the chat feed and of the own feed, with a **Stop** button. It then says first
**This message is in your own feed.** or **This message is not in your own feed.**, and after that only what
disagrees, each line shown only when there is one, and each count with the verb its number takes, as in
**1 message is** and **2 messages are**. The lines here are those under a message the viewer sent. Under anyone
else's message each names **the sender's own feed** and **the sender's address** instead, as in
**This message is in the sender's own feed.**

- **2 messages are in this chat but not in your own feed**, of the sender's messages on their own stamp. A message the
  gateway paid for never gets a copy, as each message's signed `via` says, so it is never counted missing.
- **1 message is in your own feed but not in this chat**.
- **1 message carries your address, but its signature does not match**, and for more than one,
  **2 messages carry your address, but their signatures do not match**.
- Each count names its messages, five at most, newest first. A check that found nothing wrong shows the first line
  alone.
- **No own feed of yours was found in this chat.** when none is found, and under anyone else's message
  **No own feed of the sender's was found in this chat.** It says only that none was found, since copies that have not
  reached Swarm yet look the same as none.
- **Your own feed could not be read.** when a read fails, and **Your own feed is too large to check.** when it names
  more entries than the sender's messages in the chat and 25 more, or more than 1,000.
- When the source answers the chat but turns away the sender's own feed, as an event gateway that serves only the chat
  server's feeds does, it says **This source does not serve your own feed, so it cannot be checked here.** A refusal
  is a 4xx other than 404 and 429, or a network failure on two reads in a row, since a refusal without CORS headers
  reads as one but so does a dropped connection.

How the check reads, in `src/features/chat/stamp/ownFeedComparison.ts`, which only reads:

- Every press reads the whole chat and the whole own feed afresh, and nothing is kept from an earlier press, because a
  chat read before the own feed would lack messages the own feed already holds and call them missing from the chat
  feed.
- Both are read through the source picked for Chat history. The chat feed is read from its newest entry back through
  its history files, each file older than the one before and 50 at most, and each entry no file holds by its own
  index, 500 at most. Past those limits the chat is not counted.
- The chat feed's newest entry is never older than the newest message the chat on screen holds, of any type. A gateway
  may answer the lookup of that entry with one seconds old, or with none in a chat that has just begun, while the chat
  on screen reads its entries one by one. When the lookup names an older entry or none, the entry of the newest message
  on screen is read by its own index, and the chat is read back from it through its history files as above. When that
  entry is not there either, the check says **The chat could not be read yet. Try again in a moment.** and lists
  nothing as missing. My Swarm's count reads the chat the same way and says the same line, with Try again.
- Then the own feed is read from its first entry to its newest, and on past the newest by index until an entry is not
  there, since a gateway may serve a newest entry seconds old and a copy written since would otherwise count as
  missing, and My stamp would offer to copy it again.
- An entry the source answers is not there counts as missing, by the rule the chat reads its slots with, so a 404 or
  the 500 a Bee 2.6 cluster gives a slot never written. Any other answer makes the count fail rather than call a
  message missing.
- Each copy is read by its address and must be the sender's own single-owner chunk. Every copy and every chat message
  must pass the same check as a message shown in the chat and be for this chat, the copies also the sender's, or it is
  not counted.
- A copy and a chat message are the same message when their signatures are. A message has one valid signature, over
  every field it says, so a copy with the same signature is the message the chat feed shows, as far as the chat server
  that writes the feed is trusted ([what a viewer has to trust](../README.md#what-a-viewer-has-to-trust)).
- Stopping, pressing Verify again and closing the details each end the reads of the check running.
