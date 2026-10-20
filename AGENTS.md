# AGENTS.md

Read by AI coding agents and by people working in this repository. `CLAUDE.md` is the one line
`@AGENTS.md`, so every tool reads the same text.

## What this is

The Devcon 8 viewer: browse the event's streams, watch them over Swarm, and chat beside the video.
The plan and its decisions are kept by the owner outside this repository. The README says what is
built.

## Scope

- In: the stream list, the watch page and its player, and the Swarm design.
- In: the My Swarm panel. There a viewer signs in with Swarm ID or chats as a guest with a display
  name, and lists the sources they read from: gateways, a Bee node of their own, and Weeb3, a Swarm
  node that runs in the browser tab. Under Use for they pick which source each part is read from.
- In: a chat per stream, and the choice of who pays for a message, the event gateway or the viewer's
  own stamp. On their own stamp, Swarm ID stamps each message in its hidden frame, and the page sends
  it through the viewer's Bee node or Weeb3. The page never holds a stamp key or buys a stamp. It only
  carries the finished stamp to the node.
- In: a theme switcher for viewers logged in to the chat. A deployment picks its theme with `theme` in
  `config.json`, which decides the logo and the words. A viewer's switch changes only the colours and
  typefaces, and `themeSwitcher` turns it off.
- Out, and staying out unless the owner says otherwise: admin sign-in, the page holding wallets or
  stamp keys, buying or managing stamps, uploads beyond chat messages, creating or managing streams,
  and any theme beyond `swarm` and `web3privacy`.

## Rules

- Real host names, addresses, domains, keys and stamp ids stay out of the repository. Name a host by
  its role and use a placeholder for an address.
- What differs between deployments is a setting in the runtime config, never a literal in the code.
- A bug gets its own pull request, with a test that fails before the fix.
- When you change behaviour, change the page that describes it in the same pull request.
- Browser and end-to-end suites check that things work. Timings are reported, never asserted.
- Nothing is deployed without the owner's word.
- A comment carries context the code cannot, never a narration of the line below it.
