# The Freedom browser's node

[Freedom](https://github.com/solardev-xyz/freedom-browser) is a browser that runs its own Swarm node (Ant) and lets a
web page read through it with `window.swarm`. A viewer who opens this page in Freedom can add that node in My Swarm as
"This browser's Swarm node" and read the video, the stream list and the previews through it, instead of the event
gateway. This page says what the source reads, through which of Freedom's methods, within which limits, and what was
not tested. A developer changing the `freedom` kind starts here.

The Freedom side is described in Freedom's own
[Swarm provider API](https://github.com/solardev-xyz/freedom-browser/blob/main/docs/swarm-provider-api.md). The code is
`src/swarm/providers/freedom/`: `freedomProvider.ts` is the provider, `freedomSwarm.ts` finds `window.swarm` and
connects the site.

## When it is offered

- Only when the page runs in Freedom, `window.swarm?.isFreedomBrowser === true`. Freedom puts `window.swarm` in the top
  frame of every page, of any origin, and not in a private window. Outside Freedom, Add source shows its three tiles as
  before.
- Only with `experimental` on, like every other source a viewer adds: with it off My Swarm has no Swarm access at all
  ([the experimental switch](configuration.md#the-experimental-switch)).
- A browser holds one. It has no address, and is kept in `swarm-sources` as type `freedom` with an empty `url`.
- It is never the default. A viewer picks it under Use for.

## What it reads, and how

| Read                                    | Through                                                                                                                                                                                                                            |
| --------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A feed's head                           | `swarm_readFeedEntry { topic, owner }`, Freedom's own lookup, which names the index                                                                                                                                                |
| A feed entry by index                   | `swarm_readFeedEntry { topic, owner, index }`, a body longer than one chunk joined by Freedom                                                                                                                                      |
| A single-owner chunk                    | `swarm_readSingleOwnerChunk { owner, identifier }`, its signature checked by Freedom                                                                                                                                               |
| A chunk                                 | `swarm_readChunk { reference }`, given back as its span and payload, as Bee's `/chunks`                                                                                                                                            |
| A single-owner chunk by its address     | `swarm_readChunk` answers `chunk_type_mismatch`, so `swarm_readSingleOwnerChunk { address }`, given back whole: identifier, signature, span and payload, which a caller that checks the owner, as the chat does, reads as from Bee |
| Bytes                                   | `swarm_readData { reference }`                                                                                                                                                                                                     |
| Segments, preview segments and pictures | `bzz://<reference>/`, loaded by the browser and by hls.js's fetch loader                                                                                                                                                           |

A single-owner chunk whose span is longer than one chunk wraps the root of a tree, so its body is read whole with
`swarm_readData` at the wrapped chunk's address, as Bee's `/soc` joins it.

A segment at `bzz://` goes through hls.js's fetch loader, since Freedom registers the scheme for `fetch` and promises
nothing for XHR (`CustomFragmentLoader` in `src/features/player/CustomManifestLoader.ts`). Such a segment counts for the
video's source in the failure bar, and ends no feed backoff, since the playlists are read through `window.swarm` and a
segment arriving says nothing about those reads. Ant serves a raw `/bytes` reference at `bzz://<reference>/` from v0.5.53.

## Answers

Every call that fails is an answer, never a rejection:

| Freedom answers                                                    | The read answers                                |
| ------------------------------------------------------------------ | ----------------------------------------------- |
| `-32602` with `feed_empty`, `entry_not_found` or `chunk_not_found` | not found                                       |
| `-32602` with `rate_limited`                                       | rate limited, waiting until its window ends     |
| `-32602` with any other reason, and `4200`                         | unsupported                                     |
| `4900` with a reason such as `node-stopped`, or with none          | unavailable, the reason or "switched off" in it |
| `-32603` `Request timed out`, the shim's own window                | unavailable, timed out                          |
| any other `-32603`, a Bee error passed through                     | unavailable                                     |

A read cannot be cancelled in Freedom. A read the caller stops answers aborted at once, and its late result is dropped.

Every read is given at least 15 s (`shortestReadWindowMs`). Freedom asks its node whether it is up before every read,
with a 5 s limit. Measured on Ant, the stream list's head took 6.5 s cold and 0.8 s warm, and a slot not written yet
answered 404 in 1.6 to 2.1 s, against 0.35 s on a gateway. So a follower on Freedom sees a new segment up to about 1.5 s
later than on a gateway.

## The read budget

Freedom counts this site's reads, all of them together, over a fixed minute that starts at the minute's first read: 120
requests and 512 KiB for a site the viewer has not connected, 600 and 5 MiB for one they connected. Over the budget,
every read is refused until the minute ends. Segments and pictures at `bzz://` are not counted.

- **Over the budget, reads go to the event gateway.** The client has no fallback between sources, so the provider
  carries this one itself: once Freedom refuses a read for the budget, that read and every read after it go to the
  deployment's default gateway until Freedom's minute ends, then back to Freedom. A refusal names only the minute's
  length, so the page keeps when it sent the minute's first read and waits only what is left of it; a refusal that lands
  after that, as the first read reached Freedom a moment after it was sent, holds reads back for 1 s, and so does a
  refusal of a read sent in the first second of the page's next minute, which may have reached Freedom in its last.
  Such a read started no minute in Freedom, so the page counts its minute from the next read it sent, however long
  after, that Freedom did not refuse late too. Freedom counts the site's reads together, so every part picked for this
  source shares that one wait: after the stream list's refusal, the player and the previews read through the gateway
  too, with no refusal of their own. A blob larger than the site's whole byte budget is read there too. The diagnostics
  count those answers under this source. A client made for this source alone, as for its checks, has no gateway behind
  it, and answers rate limited.
- **What a viewer reads.** The player follows the quality it plays, about 36 reads a minute for a ladder of four
  qualities in `test/freedomBudgetLadder.test.ts`, which fits the anonymous budget. The stream list and the previews
  read through the same budget when they are picked for this source. That test spends the budget the way a browse page
  of stream cards can, and shows the player stays within two playlists of the newest while the gateway serves, and
  reads through Freedom again after the minute.
- **Connect this site.** The source's add view and its settings say what connecting does, with a Connect this site
  button that calls `swarm_requestAccess`, Freedom's one-time connect prompt, which raises the budget to 600. The page
  asks only on the viewer's click, never as it loads. Whether the site is connected is read with no prompt from
  `swarm_getCapabilities`. A viewer who declines is told so, and the page does not ask again until it is loaded again.

## Its checks and its status

Its checks, before it is added and on Test connection: Open in Freedom (`window.swarm` is there), Its Swarm node answers
(`swarm_getCapabilities`), and Reads this event's stream list (its head, then its entry by index). Freedom reports
whether its node runs only to a connected site, so for any other the node's state is known from the stream list read.
With Identity & Wallet off in Freedom's settings every call fails with `4900` and no reason, and the check says to turn
it on. Not open in Freedom is said only where the page has no `window.swarm`. Any other error of
`swarm_getCapabilities`, such as a `-32603`, passes Open in Freedom and fails Its Swarm node answers with Freedom's
error code. An answer of no shape, or a failure with no error code of Freedom's, fails it as an answer the page cannot
read, naming no code. The light status says failing for both.

Whether the site is connected is read from the `reason` Freedom names in the same answer. An answer without a reason,
or no object at all, leaves it unknown, and the page shows the Connect this site button as it does before it knows.

Its light status in the list is `swarm_getCapabilities` again, which Freedom does not count against the budget.

## Use for

It is offered for the video, the stream list and the previews, and not for the chat history: a chat polls its slots,
which would spend most of the budget. The chat is read as before. Sending a message on the viewer's own stamp through
Freedom is not built.

## The policy

`bzz:` is in the content security policy's `connect-src`, for segments and preview segments, and `img-src`, for
pictures ([the image](image.md#what-the-page-may-reach)). The video plays through blob URLs, so `media-src` is
unchanged.

## Not tested

Nothing here has run inside Freedom. The unit suite drives the provider against a fake `window.swarm` that follows
Freedom's documented answers, and the browser journey (`e2e/freedom.e2e.ts`) adds the source, connects the site and
reads the stream list through a fake injected before the page loads. Chromium refuses a `bzz://` request before
Playwright sees it, so no journey loads a segment or a picture that way. `test/CustomFragmentLoader.test.ts` covers the
segment path with hls.js's fetch loader stubbed.
