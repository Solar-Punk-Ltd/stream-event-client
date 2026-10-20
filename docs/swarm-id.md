# Swarm ID

Swarm ID lets a viewer sign in and chat under a verified identity instead of as a guest. It is a separate site that
holds a person's accounts and gives each site they sign in to a chat key for one of them. This page says how the
viewer signs a person in with it, what a reader sees, and what a deployment and the Swarm ID site need for it.

Swarm ID is an experiment, and a project of its own: Solar Punk's fork of swarm-id, in
[Solar-Punk-Ltd/solarpunk-id](https://github.com/Solar-Punk-Ltd/solarpunk-id). This viewer only uses it, and the
[README](../README.md#experimental-your-own-way-into-swarm-and-swarm-id) says why it is offered.

A deployment names its Swarm ID site in `swarmId.url` ([configuration](configuration.md)), and the viewer then offers
signing in with it beside chatting as a guest. Everything the viewer uses of the library, `@solarpunkltd/swarm-id`
0.10.0 from the Solar Punk fork, goes through `src/features/chat/swarmId/`, and only `swarmIdLibrary.ts` there
imports it.

## Signing in with Swarm ID

My Swarm offers two ways in. **Chat as guest** takes a name, as [the chat](chat.md) says. **Sign in with Swarm ID** is
Swarm ID's own button, a small frame of the Swarm ID site in My Swarm, and its click opens the Swarm ID window, which
the Swarm ID site draws, not this page. The person picks an account there, or makes one.

The ID then gives this site its chat key for that account and a chat binding, the account's signed statement that the
key's address on this site is its own. Every message is signed with that key and carries the binding, so every reader
shows the Swarm ID badge. The page never connects a wallet and never sees the account's own key. The Swarm ID site
does, so a person trusts whoever serves it, as [what a viewer has to trust](../README.md#what-a-viewer-has-to-trust)
says. Messages go through the event gateway, which stamps them, unless the person picks their own stamp, as
[who pays for a message](own-stamp.md) says.

- **The Bee node Swarm ID uses for this site.** The page hands Swarm ID the address of the source picked for the chat
  history, as a Bee API base, when it starts the library and again whenever that source changes, so this site's content
  in Swarm ID follows the viewer's choice. For the event gateway that is `chat.readUrl`.
  - A source with no Bee address, the node in this browser, is never handed over. Swarm ID then keeps the address it
    had, as it does when it refuses one, which is asked for again at the next change.
  - Swarm ID's coordination of the person's account and devices stays on their own node whatever this page names.
  - The address is handed over absolute, so `/bee` arrives as this site's own `/bee`.
- **Swarm ID reads that address from its own origin**, through its hidden frame, so the address has to let the Swarm
  ID site read it. The image does this for `/bee` in proxy mode when `SWARM_ID_URL` is set: `/bee` then answers that
  one origin, never `*`, with the gateway's own CORS headers replaced, and answers a preflight for GET itself. The image
  serves nothing else Swarm ID may be handed. **A deploy requirement:** `chat.readUrl`, a gateway in direct mode and
  every gateway in `providers.gateways` are on hosts of their own, and each has to allow the Swarm ID site's exact
  origin for GET itself, or Swarm ID cannot read this site's content through it.
- **The chat name** is the account's name, trimmed and cut to the chat's 20 characters. An account with no name, or
  with one the chat refuses, such as one ending in .eth, chats under its short address. The header shows the chat name
  with its badge, the grey hexagon of a guest or the filled one of Swarm ID, as every message does. My Swarm shows the
  name once, says "Swarm ID", with the account's own name beside it only where it differs from the chat name, and Sign
  out. Under them are the public chat address and the Swarm ID account's address, each short and expandable as in a
  message's details.
- **The wallet link, for an ENS name.** While the person has "Show my ENS name on sites" on in Swarm ID, the ID also
  shares a wallet link: a statement signed by the account's wallet and countersigned by the account that the two belong
  to the same person. Every message then carries it beside the binding, so a reader can show the wallet's ENS name, as
  [ENS names](#ens-names) says.
  - The page checks the link first, as every reader will, and leaves out one that does not name the signed-in account,
    so the person still chats and no reader refuses their messages. Without the setting nothing of the wallet is sent.
  - The page follows the newest session Swarm ID reports, so turning the setting off or on while signed in reaches
    the very next message, one already typed among them. Swarm ID reports the change at once to an open page, and on
    its next load to a page that was closed. Messages already sent keep the link they carried.
- **A guest can sign in later.** The menu of a guest says "Swarm ID" beside Sign in with Swarm ID. Signing in keeps the
  guest's name and key in this browser, and signing out chats as that guest again. Leave forgets the guest.
- **What stays in memory only.** The chat key, the binding and who is signed in are never written to storage. A reload
  asks the Swarm ID library, whose frame keeps its own session for this site and signs the person in again without a
  window. When that session has ended, the person signs in again and the window opens again. Sign out ends that session
  too, so a reload does not restore it.
- **Why the button is Swarm ID's own.** The viewer and the Swarm ID site are on different sites, so the browser keeps
  Swarm ID's frames in this page apart from the Swarm ID site's own storage, as Chrome does.
  - The session reaches such a frame only from a window a Swarm ID frame opened itself, and a frame may open a window
    only after a click inside it. A window the page opened from a button of its own would end on Swarm ID's
    "Connected" with this site still signed out, so the page has no button of its own for it and never opens the
    window.
  - The library's `mountButton` shows the button, in a container the page sizes. The page hands it the label in the
    design's words and the look of the page's own button it replaced, read from the theme the page wears: the primary
    button in My Swarm's sign-in and in the warning above the message field while sending is held, and the secondary
    one beside a guest's name, in the stamp group and in a warning that lets sending go on.
  - That look is the button's fill and label colours, corner radius, typeface, size and weight
    (`swarmIdButtonLook.ts`). A viewer's theme switch changes the button in place.
- **The button's typeface is the page's own.** The page hands Swarm ID's frame the font file the build bundles for the
  theme's typeface at the button's weight, Geist for the Swarm theme and Archivo for Web3Privacy, the Latin file at
  semibold or bold, at its address on this site, and the frame loads it itself (`swarmIdButtonFonts.ts`). It is the
  same file the page's stylesheet uses.
  - The frame fetches it from its own origin, so the image serves the font files with an `Access-Control-Allow-Origin`
    naming the `SWARM_ID_URL` site. A deployment whose fonts do not allow that site, such as one served by something
    other than the image, gets the frame's fallback typeface and a line in the frame's console.
  - Swarm ID takes a font file only over https, or over plain http on this machine, so a page served over plain http
    elsewhere hands it none.
- **The button is mounted once for as long as it is shown.** Closing My Swarm takes it away and leaves the session as
  it is.
  - Until Swarm ID's frame shows its button, a placeholder stands in its place: the page's own button of the same look
    and size, with its label and a light band crossing it from left to right, which takes no click and no focus. To a
    screen reader the placeholder is a picture named "Connecting to Swarm ID", and a status that stays in place says
    the same. The frame then shows the button in the same place, so nothing moves.
  - A spinner shows on the button only while the Swarm ID window it opened is still signing in, and lets clicks
    through to the button under it.
  - When the wait passes 30 seconds, a line under it says "Swarm ID is taking longer than usual." in that same status.
  - That place is never narrower than the label with a spinner, so the smaller button beside other words, as in a
    guest's Swarm ID row, shows its whole label down to a 320 px wide screen.
  - When Swarm ID refuses the button, or it does not answer within the library's 30 seconds, its place says "Swarm ID
    cannot be reached right now." with Try again, which takes that button away and mounts a new one, showing the
    placeholder until the new button is ready. The console warns once, as for a Swarm ID that does not start. A
    viewer already signed in stays so.
  - The button's label is also its accessible name.
- **A blocked window.** The click is Swarm ID's own, so a browser opens the window unless it blocks pop-ups outright.
  When it does, the line under the button says "Your browser blocked the Swarm ID window. Allow pop-ups for this site,
  then press the button again." The page has no window of its own to offer instead.
- **A binding the chat would refuse** is refused at sign-in rather than at every message: one made for another site,
  naming another address than the key's, or signed by another account than the one the frame says is signed in, leaves
  the person signed out with the reason (`swarmIdSignIn.ts`).
- **When the Swarm ID site cannot be used**, as for a site it does not serve, My Swarm says it cannot be reached and
  guests still chat.

## ENS names

A Swarm ID sender who has "Show my ENS name on sites" on carries a wallet link in every message, as above. The page's
check in the Web Worker verifies both of its signatures and that it names the account the binding names, and only then
does the message say which wallet it is. The page then looks that wallet's ENS name up through `ensRpcUrl`, an
Ethereum mainnet JSON-RPC endpoint the deployment names, with the Swarm ID library's `resolveVerifiedEnsName`
(`src/features/chat/ens/`). A name counts only when the wallet's reverse record names it and the name's own record
names the wallet back, and it is already in its ENSIP-15 normalised form.

- **What a reader sees.** The verified name replaces the name the sender chose, on the message and at the head of its
  details, with the Swarm ID badge as for any Swarm ID sender and no mark of its own.
  - The details add an **ENS** row with the name and a tick, which a screen reader reads as "ENS name checked", the
    name the sender chose and the short wallet address, which a press shows in full.
  - A name with characters outside ASCII says "contains non-Latin characters" there, because such a character can pass
    for a Latin letter of another name, and carries a small mark with that label beside it on the message.
  - A long name ends in an ellipsis on the message, whole under the pointer and in the details. Every name is drawn
    isolated from the text around it, so its direction never moves the badge, the time or the message.
- **When there is no name.** A wallet with no name, a name that fails a check and a lookup that fails or runs out of
  time all show the message under the name the sender chose, with no ENS row.
- **When it looks.** After a message is drawn, never before it, so a slow endpoint holds nothing up. Messages of one
  wallet share one lookup, at most four lookups run at once, and a name found is kept for ten minutes, so a name moved
  to another wallet shows within that. The library keeps its own answers too, a name or no name for ten minutes and a
  failed read for 30 seconds.
- **Without `ensRpcUrl`**, or without a chat, no name is ever looked up and no wallet is ever asked about.
- **Whom the endpoint is trusted with.** It decides which name is shown beside a wallet, since nothing checks its
  answers against the chain, and it sees every wallet looked up, from each viewer's own address. A deployment names an
  endpoint it trusts with both.

## How the page talks to Swarm ID

The library is a file of the bundle of its own, fetched when the page starts on a deployment that offers Swarm ID,
because restoring a session needs it. It embeds a hidden frame of the Swarm ID site, and Swarm ID's button is a second,
visible frame of the same site, which is why the image's `SWARM_ID_URL` adds that site to the policy's `frame-src`, and
talks to both with `postMessage`. The window is a window of its own, opened by the button's frame, which the policy does
not govern.

`config.json` is mounted rather than written by the image, so the site is named twice, and `SWARM_ID_URL` and
`swarmId.url` must be the identical origin. When they differ the policy refuses the frame, the page offers no sign-in,
and the console warns once, naming both settings. It warns the same when the Swarm ID site does not start for this page
at all.

## What the Swarm ID site requires

It serves only the sites on its allow list, an ENS text record, and refuses any other: the library cannot start and the
page offers no sign-in. The list is enforced by the Swarm ID site's own code, so it holds as far as whoever serves that
site is trusted ([what a viewer has to trust](../README.md#what-a-viewer-has-to-trust)). The list is described in `docs/Site-Allow-List.md` of
[the Solar Punk fork of Swarm ID](https://github.com/Solar-Punk-Ltd/solarpunk-id). A site is added by its exact origin,
`https://` and the host as the browser reports it. For local work, a development build of the Swarm ID site also serves
the origins named in its `PUBLIC_SITE_ALLOW_LIST_DEV_ORIGINS`, which may be local http, such as the dev server at
`http://127.0.0.1:5173`.

Serve the viewer and the Swarm ID site on different sites, such as the viewer at `127.0.0.1` and the Swarm ID site at
`localhost`. On the same site the frame reads the session from storage it shares with the Swarm ID site, and a session
read that way carries no binding, so the page says Swarm ID signed in without confirming a chat address and stays
signed out. A binding for a local http site passes only on a page served over local http, as `pageScope` in
`src/features/chat/verify/verdicts.ts` decides for every check.
