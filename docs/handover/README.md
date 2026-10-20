# Handover

What a developer new to this repository reads, in this order. Each page has one job and points at the code and at the
topical pages under `docs/` for the detail.

1. [Overview](overview.md): what the app is, what a viewer does, what runs where, and how a request flows.
   [The whole stack](stack.md) beside it: every repository the event's streams and chat depend on, a stream and a chat
   message followed end to end, and the Swarm words these docs use.
2. [Architecture](architecture.md): the folders and what each owns, the import direction and the Swarm boundary test,
   the app shell, the runtime config, the Swarm client, state and browser storage.
3. [Components](components.md): every feature with its main components, hooks and modules, one line each.
4. [Specs](specs.md): the behaviour the app guarantees, each with the file that enforces it and the test that covers
   it.
5. [Development](development.md): run, test, lint, typecheck, the ratchets, the image, CI and release tagging.

The topical pages under `docs/`, one per feature, are listed in the root [README](../../README.md#documentation). The
repository's own rules are in [AGENTS.md](../../AGENTS.md) at the root.
