# The full-flow test kit

The kit brings the whole chat and identity stack up on one machine with one command, and drives it with named
people and verbs written as data. It runs the real Swarm ID app, the real chat library, the real chat server and real
Bee nodes on a local chain, so a flow that the browser journeys fake runs here for real. Every address it uses is a
local development host, every key is made for the run, and the only money it moves is test money on its own chain.

## Commands

```bash
pnpm kit up               # start the stack, or keep the one that is up, and refuse when it is not healthy
pnpm kit up --fresh       # the same from nothing: chain, nodes and generated values made again
pnpm kit status           # what runs, what each check reads, and where each part answers
pnpm kit run my-stamp-send   # or any scenario in scenarios/
pnpm kit libraries        # pack the libraries kit.lock.json pins and link them for the kit itself
pnpm kit bake-ens         # fork Ethereum mainnet once and dump the ENS snapshot, the one command that reads the network
pnpm kit down             # stop the containers and keep their volumes
pnpm kit down --fresh     # remove the containers, their volumes and the generated values
pnpm kit probe            # measure the addressing schemes, see below
pnpm test:kit             # up --fresh, every scenario, down --fresh, for one CI job with a Docker daemon
pnpm kit live run eth-name-refused --target <file>   # one scenario against a real deployment, see Live mode
pnpm kit live test --target <file>                   # every live scenario against it
```

The first `kit up` on a machine builds every image, which compiles Bee from source and installs the Swarm ID fork.
Later ones reuse them.

## What runs

| Part        | Address                                             | What it is                                                                                                               |
| ----------- | --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Viewer      | `http://127.0.0.1:4180`                             | this repository's own nginx image, with a `config.json` made for the stack                                               |
| Swarm ID    | `http://localhost:5500`                             | the Solar Punk fork's identity UI on its development server, its allow list naming the viewer                            |
| Signaling   | `http://localhost:5520`                             | the fork's account-bus signaling server                                                                                  |
| Gateway     | `http://localhost:8080`                             | nginx in front of worker-1, stamping every chat write with its own batch                                                 |
| Chat server | `http://localhost:3100/health`                      | swarm-chat-aggregator-js, listening on the queen, writing its feeds through worker-2 and its heartbeats through worker-1 |
| Bee         | `:1633` queen, `:16331` worker-1, `:16332` worker-2 | bee-compose's nodes, all full nodes, on Bee at the pinned version                                                        |
| Chain       | `http://localhost:9545`                             | bee-compose's anvil on its baked Gnosis snapshot, chain 100                                                              |
| Ethereum    | `http://localhost:8546`                             | anvil booted offline from the kit's ENS snapshot, chain 1, read by Swarm ID and the viewer for ENS                       |

worker-2 is the viewer's own Bee node, the one a person's My stamp messages go through. The versions and commits
of everything above are in `kit.lock.json`, and bee-compose is the version `package.json` names. Containers reach
one another by service name on the kit's own Docker network. Every port is published on loopback only.

## The libraries under test

The viewer and the chat server are built against the chat library and the Swarm ID library that `kit.lock.json`
names under `libraries`, installed over the versions their own lockfiles name. Before a release is published an
entry names its repository and commit, with `dir` for a package in a folder of a repository that holds several, and
`kit libraries` packs it in a container from exactly that commit, as `npm publish` would. After the publish the same
entry becomes `{ "npm": "9.0.0" }`, and the kit runs what users install. The packed set is the build context the
viewer's and the chat server's images install from, so both run the same bytes. `kit up` packs and links them first.

The kit's own process reads the chat feed with the same chat library, so `kit libraries` also installs the set in
`node_modules/.flow-kit/` and points `node_modules/@solarpunkltd/*` at it. That leaves `package.json` and the
lockfile as committed, and a plain `pnpm install` puts the published versions back, until the next `kit libraries`.

## ENS

Swarm ID and the viewer read ENS from the kit's Ethereum chain, anvil booted from a snapshot committed in
`images/ethereum/`, so no run reads the network. `kit bake-ens` makes the snapshot: it forks mainnet at a block near
the head of a public endpoint, and as the owner of `solarpunkid.eth`, by impersonation, sets that name's
`buzz.solarpunk.sites` record to the viewer's origin and gives two wallets names under it,
`flowkit-alice.solarpunkid.eth` and `flowkit-bob.solarpunkid.eth`, each with its address and reverse record. The
wallets' keys come from fixed phrases, so they are the same on every bake and worth nothing outside the kit's chain.
It then runs every lookup the kit makes through Swarm ID's own library, writes every account and slot those reads
touched into the chain, since a fork's dump keeps only what was written, dumps it, boots the dump offline and runs
the lookups again. `images/ethereum/snapshot.json` records the block, the names and the dump's hash. Two bakes from
the same block give the same hash. The public endpoint serves only recent blocks, so a later bake forks from a new
block and gives a new snapshot with the same names. Swarm ID takes only https origins from that record, so the kit's
http viewer is still admitted through Swarm ID's development origins, and the record is read and set aside.

## Accounts and wallets

An account is made with a password, a passkey or a wallet. A passkey is a Chrome virtual authenticator with the PRF
extension, as the Swarm ID fork's own suite installs it. Its credential lives in the tab that made it and loses its
PRF secret when copied to another, so a passkey account is made in the sign-in window opened from the viewer, which
signs the person in at the same time. A wallet is an EIP-1193 provider the kit puts in Swarm ID's pages, named
MetaMask so Swarm ID's wallet picker offers it, which signs in the kit's process with a key made for the run, funded
on the local chain, or with `--ens-name` the wallet the ENS snapshot named for the actor. Swarm ID's documents get the
provider and the kit's network settings from an init script, and a sign-in window that opened before the init script
reached it is given them and loaded once more. A document is never rewritten on its way in, since Chrome then counts
it as public and refuses its requests to loopback.

## The browser guard

Two layers keep every actor's browser on this machine. Each actor's context routes every request and stops one to a
host off this machine. Under that, the browser starts with a resolver rule under which every name but `localhost` and
names under it resolves to nothing, so a request the routing does not see still reaches no outside host. Service
workers are blocked, since their requests can pass the routing, and the viewer's Weeb3 fake needs none.
`expect outside-blocked`, in `my-stamp-send`, proves both: the viewer's page asks for an outside https address and the
routing stops it, and a page of the same browser with no routing at all cannot resolve that address's name.

Each stopped request is judged once, at the end of the step it came in, or after the last step until the browsers
closed. Such a request fails that step, or the run after its last step, naming it, unless the release is known to
make it: Swarm ID's wallet picker loads a font from its author's site and reads mainnet through viem's default
endpoint. Those are stopped too and listed in the verdict with why they are made, and the list is in
`src/addresses.ts`. The guard sees what the browser asks for. The kit's own process and the containers are not under
it.

## The addressing scheme

Swarm ID's frames in the viewer must live apart from Swarm ID's own storage, as they do for any two separate sites,
so the viewer and Swarm ID must be two sites. `kit probe` measures that in a Chromium with third-party storage partitioning
on, for two schemes. The first puts each part on a name of its own under `localhost`. The second puts the viewer on
`127.0.0.1` and Swarm ID on `localhost`, the pair the Swarm ID fork's own suites use. It also asks the chat library
whether a Swarm ID binding naming the viewer's origin is accepted, because the chat, the chat server and Swarm ID
take a plain http site only on `localhost`, `127.0.0.1` or `[::1]`. `kit up` serves the first scheme that passes
both, and records the probe with the stack. `KIT_ADDRESSING=names` or `loopback` overrides the choice.

## The preflight

`kit libraries` and `kit bake-ens` refuse, and exit 1, when the Docker daemon is not on this machine, before they build
or run a container. `kit up` refuses to start, and exits 1, when an address is not a local development host, when the Docker daemon is
not on this machine, when one of its ports is held by another program, when Docker has less than 4 GiB, or when
bee-compose's containers belong to another cluster. After the bring-up, and before every scenario, the same gate refuses a chain that does not answer chain
100, a Bee node that is not ready or has fewer than two peers, a chat server whose `/health` is not 200 or none of
whose heartbeats has come back through the inbox yet, an ENS lookup of a baked wallet that does not give its name, a
stamp of
the chat server that is not usable or is 80 percent full, and a gateway stamp that is not usable. The gateway's
stamp is held to being usable alone, because every chat write and every heartbeat goes to the inbox's one address,
Bee's own stamper takes a new slot of that address's bucket for each, and the mutable batch wraps the bucket, so it
reads full a few minutes after the first write and keeps working.

## Scenarios

A scenario is a JSON file in `scenarios/`: a name, a description, a browser profile, its actors and its steps, one
line each. A step is `<actor> <verb> [args]`, or `expect <check> [args]` for an assertion. Quoted text is one
argument, and `{run}` in it becomes the run's id, so a scenario run twice on one stack does not meet its first run's
messages. A `--flag` with no value after it is a flag. Every verb is a function in `src/verbs.ts`,
`src/accountVerbs.ts`, `src/chatVerbs.ts` or `src/securityVerbs.ts`, registered by name, and a step naming a verb the kit lacks fails the run
before anything starts. A scenario with `known` reproduces a finding of the release and stays red until it is fixed.
`known` names the finding and `failsAt`, the step whose failure is its direct evidence. `kit test` passes while the
scenario fails at that step, and fails when it passes, so it is turned into one that must pass, or when it fails at any
other step, since that failure says nothing about the finding. The verdict records the step it failed at. A scenario
with `accepted` must pass, and its expected result is a limit of the product by design, named in `limit` in plain
words. The verdict and the run's line carry it, so such a pass is never read as more than it is.

A step that needs one of Swarm ID's buttons waits for it to show in Swarm ID's frame. Under load the frame can miss the
Swarm ID library's start deadline, and the viewer then gives up on the button and offers Try again in its place. The
kit presses Try again once, as a person would, and records each press in the verdict under the finding
`Swarm ID button tried again`, with the button and the viewer's words. If the viewer gives up a second time, the step
fails with those words.

| Verb                                             | What it does                                                                                                                                                 |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `create-account password`                        | an account made on Swarm ID's own site with a password made for the run                                                                                      |
| `create-account wallet [--ens-name]`             | an account secured with a test wallet, made for the run or the one the snapshot named for the actor                                                          |
| `create-account passkey`                         | an account made with a passkey in the sign-in window from the viewer, which also signs in                                                                    |
| `sign-in viewer`                                 | Swarm ID's button in My Swarm, its window, the account unlocked its own way and confirmed there                                                              |
| `sign-out`                                       | Sign out in My Swarm, after which the viewer offers Swarm ID's sign-in again                                                                                 |
| `connect-source bee`, `gateway` or `weeb3`       | where Chat history is read from, in My Swarm. weeb3 is the viewer's fake, named in the verdict                                                               |
| `guest "name"`                                   | asks to chat as a guest with that name                                                                                                                       |
| `send "text" [--stamp mine]`                     | a chat message, sent once the chat has read it back, and who should have paid for it                                                                         |
| `buy-drive depth=20`                             | a real batch on the chain through Swarm ID's `/dev` page, owned by the account's postage signer. Live, the standing account's next drive                     |
| `choose-stamp mine` or `gateway`                 | who pays, in My Swarm. `--pick drive` also picks the run's drive in the Swarm ID window                                                                      |
| `change-stamp`                                   | Change stamp in Swarm ID, and the run's newest drive picked in its window                                                                                    |
| `link-wallet`                                    | Show my ENS name on sites turned on in Swarm ID, so the wallet signs the link                                                                                |
| `ens on` or `off`                                | the same setting turned on or off                                                                                                                            |
| `fail-copies on` or `off`                        | the actor's browser refuses every copy into their own feed, until off, after a copy was given up                                                             |
| `own-feed-start`                                 | reads My stamp's own feed line before sending, and later own feed counts count from it                                                                       |
| `sync`                                           | Sync in My stamp's own feed line, until it says what was copied                                                                                              |
| `reload`                                         | the viewer's page loaded again                                                                                                                               |
| `wait <seconds>`                                 | nothing, for that many seconds. After a `reload`, Swarm ID's frame checks the restored sign-in a few seconds later                                           |
| `read-details "text"`                            | a message's details opened from its badge                                                                                                                    |
| `expect frames-partitioned <actor>`              | Swarm ID's frame in the viewer is kept apart from Swarm ID's own storage                                                                                     |
| `expect outside-blocked <actor>`                 | the browser guard's control, above                                                                                                                           |
| `expect chat-feed`                               | the chat feed holds every message sent, signed, vouched for, and paid where the recorded network says                                                        |
| `expect no-key-leak <actor>`                     | the account key, the stamp key and the password are nowhere the viewer's page could reach                                                                    |
| `expect no-site-stamp <actor>`                   | Swarm ID gave the viewer no stamp, the viewer offers to choose one, and nothing was stamped                                                                  |
| `expect sees <actor> "text"`                     | the message shows in that actor's chat                                                                                                                       |
| `expect sender <actor> "text" ...`               | the name, `ens:<who>` or `chosen:<who>`, the badge, the own stamp mark above it, and `ens=shown` or `none` for the ENS name mark                             |
| `expect details <actor> "text" ...`              | identity, who paid, the ENS row with its tick, and the sender's Own feed and Chat feed counts from their `own-feed-start`                                    |
| `expect own-feed-line <actor> ...`               | My stamp's line, Own feed: N of M messages and how many are missing, counted from `own-feed-start`                                                           |
| `expect ens-link <actor> on` or `off`            | what Swarm ID's frame last told the viewer carries the actor's wallet, or not. `--record` only writes down what it saw                                       |
| `expect no-wallet-link "text"`                   | the message the chat feed holds with that text carries no wallet link                                                                                        |
| `expect name-refused <actor>`                    | the guest name was refused with its reason, and the actor does not chat                                                                                      |
| `expect joined <actor>`                          | the actor chats                                                                                                                                              |
| `expect site-drive <actor>`                      | Swarm ID's frame named to the viewer the drive picked for it                                                                                                 |
| `evil visit allowed` or `unlisted`               | the hostile site opened in the actor's browser, against the Swarm ID build that lists it or the strict one that does not                                     |
| `evil sign-in [--drive none]`                    | the account signed in to the hostile site, and with `none` No drive picked for it in the connect window                                                      |
| `evil reload`                                    | the hostile site loaded again                                                                                                                                |
| `evil forge message`, `binding` or `wallet-link` | bad messages written raw to the chat's inbox: a claim of the actor's chat address and a tampered body, a binding for another site, or three bad wallet links |
| `evil replay "text"`                             | one guest message written, published, then written again byte for byte                                                                                       |
| `evil read-device-feed`                          | the account's device-state feeds read from Swarm as an outsider: the pointer, the key it carries, and the state it opens                                     |
| `snapshot-drops`                                 | the chat server's received and dropped counts, for `server-dropped`                                                                                          |
| `revoke evil`                                    | the hostile site removed from the account on Swarm ID's Apps screen                                                                                          |
| `rpc down`, `lie` or `honest`                    | the actor's Ethereum endpoint refuses every call, answers ENS's reverse lookup with a false name, or answers truthfully                                      |
| `expect evil-refused <actor>`                    | Swarm ID refused the hostile site by its allow list, and it gets no key                                                                                      |
| `expect evil-site-key <actor> "text"`            | the hostile site's chat key differs from the viewer's and the account's, the viewer's taken from the message and the frame                                   |
| `expect evil-no-stamp <actor>`                   | the hostile site has no stamp, and Swarm ID refuses to stamp a chunk for it                                                                                  |
| `expect evil-authenticated <actor>`              | the hostile site's authenticated calls are answered                                                                                                          |
| `expect evil-cut-off <actor>`                    | the hostile site's authenticated calls are refused                                                                                                           |
| `expect server-dropped <actor> reasons=…`        | the server received every forged write, dropped each for its reason exactly, and the chat feed holds none of their texts                                     |
| `expect replay-closed`                           | the repeat was dropped as a duplicate or never handed over by Bee, and which of the two is recorded                                                          |
| `expect published-once "text"`                   | the chat feed holds the message once                                                                                                                         |
| `expect rpc-answered <actor>`                    | the endpoint setting answered at least one call                                                                                                              |
| `expect device-feed-clean <actor>`               | no device-state pointer carries its key, and no state it opens holds an app secret or a signer key                                                           |
| `expect window-blocked <actor>`                  | under a popup blocker the sign-in window is refused, the viewer says so and offers the button again                                                          |

A site uses only the drive the person picked for it in Swarm ID, never the account's default in its place, so
`choose-stamp mine --pick drive` needs the viewer to offer Choose a stamp in Swarm ID and fails when Swarm ID gave
the site a stamp without a pick. `drive-needs-consent` holds the other side: a drive bought after the sign-in, My
stamp chosen and nothing confirmed, and the viewer must have no stamp.

`no-site-stamp` looks for stamped requests, ones carrying a stamp made outside Bee or naming the drive for Bee to
stamp with, in the viewer's page and in the Swarm ID frames embedded in it, which act
for the viewer's site. It leaves out Swarm ID's own windows, its `/dev` page and its sign-in window, because there
the identity app stamps the account's own state and backups with the account's drive after a purchase. That is the
account keeping its own records, not a site spending the drive, and a run that counted it failed with every step
passing.

An actor's `chatSource` of `bee` picks the viewer's own Bee node for the chat history before the first page load,
since My stamp needs one.

## Evidence

Every run writes `test-results/kit/<run id>/<scenario>/`:

- `header.json`: the commits under test, the lock, the Bee version, the browser and its switches, the addressing
  scheme and its probe, the machine with its cpu ceiling, and the other containers on the daemon
- `preflight.json` and `verdict.json`: the gate's checks, and each step with its time, its error and its screenshot
- `actors/<name>/`: the console, the whole network as a HAR, the traces and a screenshot after every step
- `metrics/before`, `metrics/after` and `metrics/diff`: every Bee node's whole `/metrics`, and every series that
  moved, ranked by how far
- `server-health-before.json` and `server-health-after.json`: the chat server's `/health`
- `services/`: each container's standard output and error apart, and its state and exit code

The trace is paused while a password is typed and until the page has left the field, while the recovery phrase is on
screen, while a drive is bought on Swarm ID's `/dev` page, whose Chain tab shows a private key, and while the kit reads
an account key or a stamp key out of Swarm ID for `no-key-leak` to look for. A step that fails inside one of those stretches takes no screenshot, since the
secret may still be on screen. Those keys are held in the kit's memory and
written to no file of its own. `no-key-leak` searches every trace as well, so a trace that caught one fails the run, as
it did before these pauses covered the typed fields. Its silence counts only when the search looked at something: the
recorded network must hold the drive's batch id, which is public, and at least one trace must hold text, or the check
fails. The viewer's page, its storage and what its window was sent are read while the browser is open.

## Live mode

Live mode runs scenarios against a real deployment instead of the local stack: its public viewer, its real Swarm ID
site, its gateway and its chat. Nothing of the local stack is started or read, and `kit up`, `kit run` and `kit test`
are unchanged.

Eighteen scenarios run live. Four need no wallet and no drive: `partitioned-storage`,
`popup-blocked`, `eth-name-refused` and `evil-unlisted`. Four sign with a wallet that owns a real ENS name:
`ens-both-ways`, `ens-off-while-signed-in`, `rpc-down` and `rpc-lying`. Four write forged or replayed messages raw to
the chat's inbox and read the chat server's counts: `forge-binding`, `forge-message`, `forge-wallet-link` and
`replay-message`. Six sign in to a standing account with its drives and send on its own stamp through the viewer's
own Bee node: `my-stamp-send`, `own-feed-sync`, `stamp-key-stays-in-frame`, `drive-needs-consent`, `two-people-chat`
and `device-feed-leak`. `kit live test` runs those eighteen, and `kit live run` refuses any other. `evil-allowed`,
`cross-site-isolation` and `revoke-while-sending` stay local only, since the real allow list never names the hostile
site. A verb that needs the local stack, such as funding a wallet or adding Weeb3, fails at once with a line saying
so, before it does anything.

A run creates Swarm ID accounts on the real site and sends a few guest messages that the deployment's gateway pays
for, from guests named `kit <actor> <run id>`. The forging and replay scenarios write a few raw inbox messages the same
way, which the gateway pays for too. A run writes nothing else: no setting, no stream list, no stamp.

### The target file

A target file names the deployment, and it lives outside this repository, because a deployment's names stay out of
it. `targets/example.json` shows its shape with placeholders:

| Field         | What it is                                                                                             |
| ------------- | ------------------------------------------------------------------------------------------------------ |
| `name`        | a short name for the deployment, written into the evidence                                             |
| `viewer`      | the viewer's origin, with no path                                                                      |
| `stream`      | the published stream to open: `mediaType`, `owner`, `topic` and `title`                                |
| `alsoAllowed` | optional, outside origins a part of the deployment reads on its own, each with `origin` and `why`      |
| `ens`         | optional, the ENS wallet's `actor`, its `address` and its `name`, which the ENS scenarios need         |
| `chatHealth`  | optional, the local end of the tunnel to the chat server's `/health`, such as `http://127.0.0.1:4997`  |
| `standing`    | optional, standing Swarm ID accounts, each an `actor`, its account `address` and its `drives` in order |
| `ownNodes`    | optional, by actor, the local end of the tunnel to the Bee node that is that actor's own node          |
| `swarmIdBee`  | optional, an https origin: the gateway Swarm ID is set to in every page, as its network settings would |

Everything else is read from the viewer's public `config.json` at the start of each run: the gateway, the chat's read
and write addresses, the chat inbox key, the feed owner, the Swarm ID site and the ENS endpoint. An address given as a
path, such as `/bee`, is on the viewer's origin. The config is checked with the viewer's own schema, and live mode
needs a single `gatewayUrl`, an enabled chat, a Swarm ID site and an ENS endpoint. The chat's feed is
`chat-<stream topic>`, and the inbox owner is the address of the config's `gsocResourceId`.

`alsoAllowed` is for what the deployment's parts reach that its config does not name. The real Swarm ID site, run as a
visitor's browser runs it, reads its accounts through its own default Swarm gateway, so a live run of a scenario that
makes an account needs that gateway named here.

### The ENS wallet

The ENS scenarios make the actor `ens.actor` names a Swarm ID account secured with a wallet that owns a real ENS name,
with its reverse record set. The wallet's key never sits in a file: the kit reads it from the environment variable
`KIT_ENS_KEY`, a 0x-prefixed 32-byte hex key, which the operator routes in from a secret store when starting the run.
The key signs in the kit's own process, and the pages only ever see its signatures. The wallet is never funded and
never sends a transaction, since Swarm ID's wallet account and its "Show my ENS name on sites" only ask it to sign.

Every run of the same wallet opens the same Swarm ID account, so a scenario sets the ENS setting itself, on or off, in
its own steps rather than relying on what an earlier run left. Each run starts from a fresh browser, and an account
with no drive publishes nothing a later run could read.

A check that names the ENS name, such as `name=ens:alice` or `details ... ens=alice`, expects the name the target's
`ens.name` gives live, and the baked snapshot's name locally. `rpc down` and `rpc lie` stop or alter the calls to the
config's ENS endpoint live, as they do the local chain's endpoint locally, and the lie lets every call but the reverse
lookup through to the real endpoint.

### Standing accounts

A drive is bought once and kept for live runs, and Swarm ID cannot take a drive into another account, so an actor a
scenario gives a drive signs in to the same Swarm ID account on every run, a standing account, instead of making one.
Live, `create-account password` for an actor with a `buy-drive` step signs in to that actor's standing account from its
recovery phrase, through Swarm ID's "I already have an account", and secures it in the run's fresh browser with the
account's password. The account must be the one the target's `standing` entry names, holding every drive it names, or
the step fails saying what the phrase opened. Each `buy-drive` then takes the account's next drive in the target's
order, with nothing bought, and a step past the last drive fails. When Swarm ID finds no account for the phrase it
offers to set up a new one under it, and the kit never takes that offer.

After the sign-in the kit sets every site on the account's Apps screen to "No drive". A site keeps the drive it was
given, so the next run would find its site already stamped, and every scenario starts from a site with no drive, as a
new account's is. A site is never removed: a removal is published to the account and ends that site's session in every
browser that restores it, so a reload would sign the actor out. This is the one change the kit makes to a standing
account, it counts the sites it changed in the verdict's `<actor> standing account` finding, and the drives stay
attached.
For the same reason `sign-in viewer` picks "No drive" in Swarm ID's window for a standing account. The window starts
its picker on the account's default drive, which a new account does not have yet, and "Go to app" would give it to
the site.

The phrase and the password never sit in a file. The kit reads them from `KIT_<ACTOR>_PHRASE` and
`KIT_<ACTOR>_PASSWORD`, `KIT_ALICE_PHRASE` and `KIT_ALICE_PASSWORD` for alice, which the operator routes in from a
secret store when starting the run. A phrase kept as a numbered list, `1. word 2. word`, loses its numbers. Before such
a scenario the live gate refuses to start when either variable is missing, naming it and how a run gets it, when the
phrase is not 12 to 24 lower-case words or the password is shorter than Swarm ID's 8 characters, or when the target
names no standing account for the actor. Neither value is ever part of what the gate writes or prints. Both are typed
with the trace paused, until the page has left their fields.

Signing in on a new device asks Swarm ID to find the account's published state on Swarm, through the Swarm gateway its
own settings name, so the target's `alsoAllowed` names that gateway. A Swarm ID older than 0.10.1 gave up reading the
account's device list before the public gateway answered a missing chunk, and refused the sign-in.

### The viewer's own node, live

A message on a person's own stamp goes out only through a Bee node of their own or Weeb3 in the tab, so the scenarios
that send on one read the chat from the viewer's own Bee node, by `chatSource: bee` or `connect-source bee`. Live, a
Bee node of the deployment's stands in for the actor's own: the operator opens an SSH tunnel to its API before the run
and names its local end for the actor under `ownNodes` in the target:

```sh
ssh -N -L 4996:<the node's API address> <the node's host>
```

```json
"ownNodes": { "alice": "http://127.0.0.1:4996" }
```

The node must know the actor's drives, since Bee refuses a chunk stamped with a batch it has not seen, so a node that
holds no batch of its own and has a funded chequebook fits best. The node pays the bandwidth of what it sends and reads
from its own chequebook. It never buys or tops up a batch for the kit. The page adds the node as a person does, and
every own-stamp send, own feed copy and device feed read goes through it. A standing drive the node does not know fails
its `buy-drive` step, saying so.

Before such a scenario the live gate reads the node's `/health` through the tunnel for each actor that uses one, and
refuses to start when the target names no own node for the actor, when the tunnel answers nothing, or when the answer is
not Bee's or not healthy, each time naming the tunnel to open. An own node must be on this machine, since only a tunnel
reaches it.

Chrome lets a public https page call an address on this machine only with its Local Network Access permission, which
it asks the visitor for. A test browser cannot answer the prompt and refuses the call with `Permission was denied for
this request to access the loopback address space`, so live, an actor with an own node is given that permission for
the viewer's origin, the way a visitor allows it. Measured on 2026-10-18 with Chromium 153 and Chrome 155: without it
every call to the tunnel fails, with it the node answers. Bee's own CORS answer took the viewer's origin. A real visitor
with a node of their own therefore meets Chrome's prompt the first time the viewer calls it.

### The live gate

Before every live scenario a gate refuses to start, and exits 1, when the viewer or its `config.json` does not answer,
when the config is refused, when the Swarm ID site does not answer, when the stream list cannot be read through the
gateway, when the target stream is not in that list, or when the chat's read address does not answer the stream's chat
feed as Bee does. A feed with no message yet answers Bee's 404, which still says the chat is there. The gate never
refuses an address for not being local. It refuses any address the run would use that the target and the config do
not name, and holds the hostile site, the one part served from this machine, to a local address.

Before an ENS scenario the gate also refuses to start when `KIT_ENS_KEY` is not set or is not a key, saying how a run
gets it, when the target has no `ens` or names an actor the scenario does not give the wallet, when the key's wallet is
not the target's `ens.address`, or when the target's name does not resolve to that address and back on the config's
ENS endpoint. The key itself is never part of what the gate writes or prints.

### The browser guard, live

The guard works as it does locally, with a different list. An actor's routing lets through exactly the origins the
target and the config name, the target's `alsoAllowed` and the hostile site, and the browser's resolver rule resolves
only those hosts and the local names. A local address the run does not name is stopped too. The requests the release
is known to make, in `src/addresses.ts`, are stopped and recorded as they are locally, and any other stopped request
fails its step. `expect outside-blocked` keeps working, since its outside address is never one a target names.

Swarm ID's pages get no network settings from the kit in live mode, and run with the site's own settings, as a
visitor's do. Only an ENS scenario offers them a wallet, the ENS wallet, the way a browser extension would. Its sign-in
window gets that wallet in the document it opened with, and is not loaded a second time, so it asks for Swarm ID's files
once.

Live, the kit fetches every request to the Swarm ID site itself, after the guard let it through. The deployment's Swarm
ID site is served from bzz.link, which answers many of a burst of parallel requests with `500 Internal Server Error`
and every file asked for one at a time with 200. A fresh test browser has an empty cache and asks for Swarm ID's whole
module graph at once, so without this its sign-in window never shows its account button. A run's actors share one
pace: at most 4 such fetches in flight over all of them, and at least 100 ms between the start of one fetch and the
next, so the run never asks in a burst. A fetch answered 500 or above, or not at all, is asked again after 1, 2, 4, 8 and 16
seconds, six attempts in all, since once overloaded bzz.link keeps answering a file 500 for 8 to 30 seconds. The page then gets the last answer, so a file that never loads still fails the step.
Locally the browser fetches Swarm ID's files itself, as before.

An actor's browser gets 60 seconds to close. Playwright writes the network recording on close and waits for every
request still open, and a live viewer's player keeps asking for its stream, so a close could wait for good. The
requests open when the close began are written to `open-at-close.json` in the actor's folder, with whether it closed
in time, and a close that ran out says so on the run's output.

`expect ens-link` waits 120 seconds live instead of 60. After a reload the deployment's Swarm ID frame can take most of
a minute to start while its files are asked again. The verdict's `<actor> ens link seen` finding says how long after
the check began the frame's first update came and when the wanted one did.

### The chat server's counts, live

`forge-binding`, `forge-message`, `forge-wallet-link` and `replay-message` prove the chat server's checks by its exact
counts: every forged write received, and each dropped once for the reason it was forged for. The server's `/health`
answers only on the deployment's own machine, so the operator opens an SSH tunnel to it before the run and names its
local end as `chatHealth` in the target:

```sh
ssh -N -L 4997:127.0.0.1:<its health port> <the deployment's host>
```

Before such a scenario the live gate reads `/health` through the tunnel, and refuses to start when the target names no
`chatHealth`, when the tunnel answers nothing, when the answer carries no counts, or when the server says it is not
healthy, each time naming the tunnel to open. `chatHealth` must be on this machine, since only a tunnel reaches it.

The forged and replayed messages are built in the kit's process and written to the chat's inbox through the config's
chat write address, the path every guest message takes, with the inbox key the config publishes for every sender. The
deployment's gateway stamps each write with its own chat batch and ignores the batch id it is sent, so the kit holds
no stamp and writes to no Bee node of its own. Locally they still go to a Bee node of the stack with the kit's stamp.

The counts are the server's since it started, and anyone's message to the chat in the same minute raises `received` as
the run's do, so a run on a deployment with other senders can fail on a count it did not cause. The server's own
heartbeats are never counted as received, and their drops, `heartbeat-repeat` and `heartbeat-unknown`, are left out
of the comparison in both modes.

### What a live check reads

`expect chat-feed` reads the chat feed through the chat's read address, as the viewer does, with the config's feed
owner and the stream's chat topic. The chat server's `/health` answers only on the deployment's own machine, so
the live read waits on the feed alone, even when the counts are read through a tunnel: it reads each written slot once and asks the next
unwritten one again every 10 seconds, until every message the run sent is there or 60 seconds pass. The verdict records
under `live chat feed reads` where it read, how many entries, how many unwritten asks and how long it waited. How each
message was paid is read from the recorded network as locally, against the chat's write address on the gateway and the
inbox owner.

`evil-unlisted` serves the hostile site from this machine, at `http://[::1]:4998`, built in the kit's own process
against the Swarm ID library this checkout installs, and opens it with the real Swarm ID site. The real site must
refuse it in its own words for a site its allow list does not serve. The strict Swarm ID build is local only, and
`evil visit allowed` refuses to run live, since the real allow list never names the hostile site.

### Live evidence

Every live run writes `test-results/kit-live/<run id>/<scenario>/`: `config.json` as the viewer served it,
`preflight.json` with the live gate's checks, `header.json` with the target, the whole config, every address the run
used, the kit's commit, the libraries, the machine and how long reading the config, the gate and starting the hostile
site took, then `verdict.json` and `actors/` as locally. A live run takes no Bee metrics, no snapshot of the chat server's
health and no container logs, since none of those are the kit's to read on a real deployment. The counting scenarios
record the counts they read before and after in the verdict. Timings are recorded, never asserted.

Two readings of the evidence are made once the browsers closed. A run that holds a live secret, the ENS wallet's key
or a standing account's phrase and password, searches every actor's recorded network, console and traces, its
`header.json`, its `preflight.json` and its verdict for each, and fails when any holds one, naming which and where
and never the value. A key is looked for in hex and base64, a typed secret as typed, as JSON and an address encode it,
and in base64. The verdict lists what was searched for under `live secrets searched for`. And every live run records `swarm id server errors` in its verdict,
from the counts each actor's fetcher writes to `actors/<actor>/swarm-id-fetches.json` when it closes: how many requests
went to the Swarm ID site, how many attempts were answered 500 or above, how many got no answer, how many retries were
made, how many files needed a retry, and how many still failed after the last attempt, summed and for each actor. The
recorded network shows only the answer each request finally got, so these counts are where the site's errors stay
seen. On a failed run that met any, the finding also names the likely cause: bzz.link answers Swarm ID's files with 500
under parallel load, a known limit of that address.

## In a CI job

`pnpm test:kit` needs a CI job with a Docker daemon. The job runs as root inside a container, so Chromium starts with
`--no-sandbox`, the browser is installed by the suite itself, and the stack's containers are siblings of the job. The
kit therefore joins its own Docker network from inside the job and forwards each loopback port to its service, so the
browser still sees only loopback addresses. Files reach the daemon by image build or `docker compose cp`, never by a
bind mount.

A CI system that runs suites by script name needs `test:kit` named to it, since the kit is not one of the usual
scripts.
