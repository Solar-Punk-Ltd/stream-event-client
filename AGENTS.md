# AGENTS.md

Read by AI coding agents and by people working in this repository. `CLAUDE.md` is the one line
`@AGENTS.md`, so every tool reads the same text.

## What this is

The Devcon 8 viewer: browse the event's streams, watch them over Swarm, and chat beside the video.
The plan and its decisions are kept by the owner outside this repository. The README says what is
built.

## Scope

- In: the stream list, the watch page and its player, the Bee node picker, the Swarm design, a
  chat per stream with a display-name login, and a theme switcher for viewers logged in to the chat.
  A deployment picks its theme with `theme` in `config.json`, which decides the logo and the words. A
  viewer's switch changes only the colours and typefaces, and `themeSwitcher` turns it off.
- Out, and staying out unless the owner says otherwise: admin sign-in, wallets, postage stamps, uploads,
  creating or managing streams, and any theme beyond `swarm` and `web3privacy`.

## Rules

- Real host names, addresses, domains, keys and stamp ids stay out of the repository. Name a host by
  its role and use a placeholder for an address.
- What differs between deployments is a setting in the runtime config, never a literal in the code.
- A bug gets its own pull request, with a test that fails before the fix.
- When you change behaviour, change the page that describes it in the same pull request.
- Browser and end-to-end suites check that things work. Timings are reported, never asserted.
- Nothing is deployed without the owner's word.
- A comment carries context the code cannot, never a narration of the line below it.
