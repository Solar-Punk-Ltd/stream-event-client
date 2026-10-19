# Who pays for a message

Every message on Swarm needs a postage stamp. My Swarm has a **Chat stamp** group, between ID and Swarm access, once
the viewer is chatting, and it offers two ways to pay. The code is `src/features/chat/stamp/` and
`src/features/connect/ChatStampSection.tsx`.

- **Gateway pays**, the default for everyone: the message goes to `chat.writeUrl`, which stamps it. That holds with
  Weeb3 picked for Chat history too: the page holds no stamp, and only the event's write path has one to pay with, so
  the history is read through Weeb3 and the message is written through the event's gateway.
- **My stamp**, offered once signed in with Swarm ID. The stamp is the one Swarm ID gives this site. It is bought,
  topped up, made bigger and chosen for the site in Swarm ID, never in this page, which holds no stamp and no stamp
  key. For each message the page builds the chunk, Swarm ID signs and stamps it in its frame with `stampChunk`, and
  the page sends the stamped chunk itself through a source of the viewer's that can carry it: to a Bee node as
  `POST /soc/<owner>/<id>?sig=...` with the stamp in Bee's `swarm-postage-stamp` header
  (`src/swarm/providers/bee-http/stampedSocUpload.ts`), or through Weeb3 with weeb-3's `postPushChunk`, the whole chunk
  at its address with the stamp's 113 bytes (`src/swarm/providers/weeb-3/weeb3Push.ts`). Every message says
  `via: "own-stamp"`. The chat's inbox is one single-owner chunk address, which Swarm ID stamps again in the slot it
  already holds, so a busy chat costs one slot of the stamp rather than one per message.

## Which source sends it

Only a Bee node of the viewer's own and Weeb3, the node in this browser, send a chunk under a stamp they are handed.
The event gateway's chat path stamps every write with the gateway's own batch, a `/bee` path on the site passes reads
alone, and the page cannot tell what any other gateway does with a stamp, so no gateway is ever sent a message on the
viewer's stamp. The message goes through the source picked for **Chat history** when that is a Bee node or Weeb3.
Otherwise it goes through the first Bee node in the viewer's list of sources, and with no Bee node there, through
Weeb3 (`ownStampRoute.ts`). The chat history is still read from the source picked for it, and nothing changes who
pays or what Use for says.

With neither a Bee node nor Weeb3 in the list, My stamp is greyed out and cannot be picked, and its line says "Add your
Bee node or Weeb3 in My Swarm to send on your own stamp." A viewer who is not signed in reads "Needs a Swarm ID
sign-in.", with "and your Bee node or Weeb3 in My Swarm" added when the list has neither. The Bee node must allow this
site's origin (`cors-allowed-origins`) for the write as for its reads, and needs the stamp's chain to check it, so a
light node or a full one, not an ultra-light one.

## Nothing switches by itself

A message Swarm ID will not stamp, or the node refuses, shows "Not sent." with the reason, and is never resent through
the gateway. A refusal a resend cannot mend, such as a stamp that ran out, fails the message at once, and Retry tries
it again on the same stamp. A node that did not answer, or a busy Swarm ID, is resent by the chat on its own, on the
same stamp and through the same node. When Swarm ID says it has given this site no stamp, which since Swarm ID 0.10.0
is every site until the person picks one there, the message reads "Not sent. Swarm ID has given this site no stamp.
Choose one in Swarm ID." and the field above the message box shows No stamp for this site with Choose a stamp in Swarm
ID at once, even when the stamp read last named one.

When the last Bee node or Weeb3 leaves the list while My stamp is picked, the choice stays, and the send area shows
that same one line, "Add your Bee node or Weeb3 in My Swarm to send on your own stamp.", with the Send button off and
what was typed kept, until the viewer adds one or picks Gateway pays. Retry resends only through the sender that took
the message. After the viewer changes who pays, the source, the sign-in or the own feed, or restarts the chat, that
sender is gone, so Retry marks the message "Not sent. The way messages are sent changed, so write it again." and takes
its Retry button away, never resending it through the new route. A message sent in the moment such a change, or a new
name or wallet link, restarts the chat waits for the new chat and goes out once, with the name, wallet link and payer
in force when it goes. When no chat starts within ten seconds it is not sent, and the field keeps it with "The message
could not be sent. Try again."

## A deadline on every push through Weeb3

weeb-3 answers a stamp it will not take with silence, never an error, so each push has a minute
(`WEEB3_PUSH_DEADLINE_MS`, measured pushes took 7 to 15 s). A push with no answer by then fails the message at once,
"Weeb3 did not confirm it within a minute.", and the chat does not send it again by itself, since a second try on the
same stamp would wait the same minute. Retry tries once more. A refusal weeb-3 names fails at once too, and a node that
is not running is started again by the chat's own resend. A stamp from Swarm ID that is not exactly 113 bytes never
reaches weeb-3: the message fails at once, "Swarm ID gave a stamp of the wrong size." Anything else that fails on the
way, such as a chunk that could not be built, fails the message at once as "Weeb3 could not push it", with what went
wrong. The own-feed copy goes through Weeb3 the same way, after the message.

**A known limit:** the deadline does not cancel the push, since weeb-3 offers no way to. A valid push slower than a
minute is reported as refused, the node is let go, and weeb-3 may still deliver the message later, when the chat reads
it back.

## The stamp's figures

With My stamp picked, My Swarm shows the site's stamp: its name, how full it is, its days left, and **Change stamp in
Swarm ID**, Swarm ID's button again, whose click opens the Swarm ID sign-in window while the viewer stays signed in
(the button's `change-stamp` action). The window shows the person's stamps, the person picks one for this site, and
Swarm ID hands it to the open page at once and reports the session again (`onConnectionChange`) with the id of the
stamp the site now uses (`postageBatchId`). When that id changed, the viewer reads the new stamp's figures with
`getPostageBatch` straight away, with no reload, and a report naming the same stamp reads nothing. A browser that
blocks that window gets the same line as a blocked sign-in, under the button. The figures are also read when the
person signs in, when My Swarm opens, when the page comes back into focus, and after messages sent, at most every 15
seconds (`siteStamp.ts`, `ChatStamp.tsx`).

**A known limit:** a stamp changed directly on Swarm ID's own Apps screen, rather than through this button, reaches an
open viewer on another domain only at its next sign-in with Swarm ID, so until then the viewer may show the old
stamp's figures.

A report with no stamp id means Swarm ID gives this site no stamp, and the page shows that at once without reading.
Every sign-in starts that way until the person confirms a stamp with Go to app in the Swarm ID window, so My Swarm says
"Swarm ID has given this site no stamp yet. Choose one and confirm it in the Swarm ID window." and the same button
reads Choose a stamp in Swarm ID until it has one.

## Warnings above the message field

Only a stamp that stops sending gets one, so a stamp running low shows nothing there, and My Swarm still says how much
is used and how many days are left. When the stamp ran out or is not usable yet, the field says so, sending is held
with what was typed kept, and two buttons offer Change stamp in Swarm ID and Let the gateway pay. When Swarm ID gives
this site no stamp the first button reads Choose a stamp in Swarm ID. A Swarm ID window the browser blocked adds its own
line under Swarm ID's button there (`Chat/StampWarningBar/`).

## The copy in the viewer's own feed

Always on with My stamp, with no setting to turn it off, and the My stamp box says so. Once the viewer's node took a
message, a copy of it goes into the sender's own feed, `ownFeedTopic(chatTopic)` from swarm-chat-js under the chat
key's address, one entry per message at the next index, stamped by Swarm ID too. The message goes out at once and never
waits on its copy, and nothing in the message says whether there is one: anyone compares the own feed with the chat
instead. A copy is the message's bytes exactly as they were sent. The feed's newest index is read once, through the
chat history's source, and counted on from there. A copy whose lookup or write fails is tried three times in all, three
seconds apart, and then left, and a copy that fails never fails its message. A copy given an index keeps it until it is
written there, since its write may have landed although it reported a failure, so the next copy first writes it there
again and the feed never holds two different copies at one index, or a gap (`ownFeedCopies.ts`). Each message is
stamped twice, but the message itself goes to the chat's inbox address, which Swarm ID stamps again in one slot, so
only the copy takes new room on the stamp.

## Own feed in My Swarm

While a chat on My stamp is on screen, the My stamp box says under the stamp how many of the viewer's messages on their
own stamp in that chat have their copy, as in Own feed: 45 of 47 messages, and 2 missing when some have none, with a
**Sync** button (`src/features/connect/OwnFeedSync.tsx`). It reads the chat and the own feed as the message details do,
within the same limits, and the viewer's messages are the ones signed by their chat address, which is the same on every
device. A message the gateway paid for is not counted and never copied. Sync writes the missing copies with the stamp,
one after the other, each tried three times as above, and says Syncing… 1 of 2 while it runs, then All 47 copied. It
stops at the first copy that fails, since every later copy would try that one again first, and says how many were not
copied, that one and the rest, with Try again. Once a sync ends it counts again, and so it does after each message the
viewer sends, once it is read back and its copy written or given up, behind the count on screen. Each count reads the
chat and the own feed afresh, as Verify in the details does. It says Counting… while it first reads, Your own feed is
too large to count past the limits, and that the source does not serve your own feed when the source turns that feed
away, with Try again.

**A known limit.** The next index is counted from one read of the feed's newest entry each time the chat starts, so a
chat started again seconds after a send, before that entry can be read back, or another device writing the same feed at
once, can write a copy at an index already used.
