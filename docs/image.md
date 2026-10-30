# The image

The viewer ships as one Docker image that any deployment runs with its own settings. This page says what the image
serves, which settings it reads at start, what the page is allowed to reach, and how a release is tagged, which is what
an operator or a developer needs to run or change it.

The `Dockerfile` builds one image for every deployment: nginx serving the built page, with the page fallback, and the
gateway at `/bee` when it is proxied. What a deployment differs by is read when the container starts, by
`deploy/nginx/40-gateway-and-policy.sh`, and the server itself is `deploy/nginx/default.conf`.

```bash
docker build -t stream-event-client .
docker run -p 8080:80 \
  -e BEE_GATEWAY_URL=https://gateway.example.com \
  -e CHAT_READ_URL=https://chat-read.example.com \
  -e CHAT_WRITE_URL=https://chat-write.example.com \
  -v "$PWD/config.json:/usr/share/nginx/html/config.json:ro" \
  stream-event-client
```

## The settings

| Setting              | What it is                                                                                                                                                                                                                                    |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GATEWAY_MODE`       | `proxy`, the default: the page reads the gateway at `/bee` on its own origin, so `config.json` names `/bee` as `gatewayUrl`. `direct`: the page reads the gateway at its own address, which `config.json` names                               |
| `BEE_GATEWAY_URL`    | Required. The gateway's address, with no path. In proxy mode `/bee` forwards to it. In direct mode the page reads it, which the policy allows at https, and names at plain http                                                               |
| `CHAT_READ_URL`      | The chat's read endpoint, the same as `chat.readUrl` in `config.json`. Checked at start, and named in the policy when it is plain http. Leave it out when there is no chat                                                                    |
| `CHAT_WRITE_URL`     | The chat's write endpoint, the same as `chat.writeUrl`, checked and allowed the same way. A `CHAT_BEE_URL` is refused and stops the container: use `CHAT_READ_URL` and `CHAT_WRITE_URL`                                                       |
| `EXTRA_GATEWAY_URLS` | Optional. The addresses of the further gateways `config.json` offers in `providers.gateways`, separated by spaces, each with no path. Checked at start, and the plain http ones named in the policy                                           |
| `SWARM_ID_URL`       | Optional. The Swarm ID site, the identical origin to `swarmId.url` in `config.json`, which the page is then allowed to frame, and which may then read `/bee` in proxy mode and the bundle's font files. Leave it out when there is no sign-in |
| `config.json`        | Mounted over the image's example at `/usr/share/nginx/html/config.json`. Without it the page shows the example's placeholders as a configuration problem                                                                                      |

A setting that is missing or malformed stops the container at start, and its log says which one. Every address must be
one origin on one line, a scheme, a host and an optional port, with no path. A setting the script does not know, such
as `BEE_NODES` or `WEEB3`, is ignored, because the policy below allows every type of source on every deployment.

## What the page may reach

The policy is the same on every deployment, because the page decides which sources it offers:

- **Any gateway, and a Bee node, at an https address.** `https:` in `connect-src` and `img-src`, so the page reads it
  and shows its pictures. A gateway's address is the viewer's to choose, so no list of hosts could hold them all.
- **A Bee node on the viewer's own machine**, at `localhost` or `127.0.0.1`, any port, over plain http, in
  `connect-src` and `img-src`. A policy cannot name `[::1]`, so that address is refused where it is typed, with what to
  type instead.
- **The ENS endpoint**, `ensRpcUrl` in `config.json`, at an https address, under the same `https:` in `connect-src`,
  so the image needs no setting for it. One at plain http is reached only on the viewer's own machine.
- **The node in this browser, weeb-3.** `'wasm-unsafe-eval'` in `script-src`, so the page and its workers may compile
  the WebAssembly module, and `wss:` in `connect-src`, so the node can reach its peers. That is every secure websocket
  host, on purpose. The package's mainnet bootnodes are all `*.libp2p.direct` names, which `wss://*.libp2p.direct:*`
  would cover, but the node also dials any peer that announces a public DNS name with TLS, and a narrower list would
  refuse those.

Plain http beyond the viewer's own machine is never allowed, apart from the addresses the image's settings name, because
a browser blocks it from an https page and a policy cannot tell the local network from the internet. Blob URLs stay
media, image and worker sources and are never added to what the page connects to.

The whole policy, as the script writes it: `default-src 'self'`, `script-src 'self' 'wasm-unsafe-eval'`, `style-src
'self' 'unsafe-inline'`, `font-src 'self'`, `manifest-src 'self'`, `img-src` and `connect-src` as above with the named
http origins, `media-src 'self' blob:`, `worker-src 'self' blob:`, `frame-src <SWARM_ID_URL>` when set, `object-src
'none'`, `base-uri 'self'`, `form-action 'none'` and `frame-ancestors 'none'`. Every answer also carries
`X-Content-Type-Options: nosniff` and `Referrer-Policy: no-referrer`.

Inline styles are allowed because the emoji picker writes its own. Blob URLs are allowed because hls.js runs in a
worker it builds from a blob and plays through blob URLs. That is also why no gateway is named as a media source:
hls.js reads a playlist with a request, so a stream card hands it its preview playlist from memory rather than as a
blob.

`/weeb-3/` always serves weeb-3's files: the WebAssembly module as `application/wasm`, and its service worker at
`/weeb-3/service.js`. The page registers that worker through `/weeb-3-host.js`, a root file the build writes, which only
loads `/weeb-3/service.js`. Served from the root it may answer the node's `/weeb-3/...` routes for a page anywhere on
the site with no header at all, so the same build works on a host that sets no headers, such as an ENS gateway.
Both are answered `no-cache`, and a missing file is a 404, never the page. weeb-3 keeps every route under
`/weeb-3/` at the site's root, so the viewer is served at the root.

## Caching, fonts and the proxy

- **Caching.** The page is served `no-cache`, so a browser asks before reusing it after a deploy. `config.json` is
  served `no-store`. The bundle under `/assets/` is named by content hash and kept for a year.
- **Font files for Swarm ID's button.** With `SWARM_ID_URL` set, the bundle's `.woff2` files answer with
  `Access-Control-Allow-Origin` naming exactly that site, because Swarm ID's button frame loads the page's typeface
  from its own origin. No other file gets the header, and without `SWARM_ID_URL` no file does.
- **The proxy passes reads only.** `/bee` forwards `GET` and `HEAD`, and with `SWARM_ID_URL` set answers `OPTIONS`
  itself for the Swarm ID frame's preflight, so the site cannot be used to write to the gateway. With `SWARM_ID_URL`
  set it also replaces the gateway's own CORS headers with ones naming that one origin. The chat writes through its own
  endpoint, `CHAT_WRITE_URL`. In direct mode `/bee` answers 404.

## The release tag and the build label

A `v*` tag publishes the image, built for amd64, as `ghcr.io/solar-punk-ltd/stream-event-client:<tag>`
(`.github/workflows/image.yml`). A deployment pins it by the digest that tag resolves to. No tag ever moves `latest`.

The workflow passes the tag and its commit into the build as `BUILD_TAG` and `BUILD_COMMIT`, and the page's Copy
diagnostics names the build by them, such as `v1.7.0-rc.5 (1fcfbd4)`.

- A build without them, such as `pnpm build` in a checkout, asks git instead: the tag on the commit, an annotated one
  before a lightweight one, else the nearest tag behind it and the commits past it, such as `v1.7.0-rc.5+3 (8e2d0aa)`,
  else the short commit alone, with `-dirty` added when the tree holds uncommitted changes.
- With neither, as in a plain `docker build`, which leaves `.git` out, it says `development build`.
- A `BUILD_TAG` that is not a plain tag name, letters, digits and `. _ + / -`, or a `BUILD_COMMIT` that is not
  hexadecimal stops the build rather than reaching the page.
- `scripts/build-label.mjs` holds the rule, and `src/shared/buildLabel.ts` reads the label the build defined, or
  `unbundled` outside a build.

## Testing the image

`pnpm test:image` (`test/docker/image.docker.mjs`) builds the image and checks it running, in both modes: `nginx -t`,
the cache headers and the policy on each kind of answer, reads and refused writes at `/bee`, weeb-3's files, and the
refusal to start without `BEE_GATEWAY_URL`. It needs a Docker daemon, so it is not part of `pnpm test`.
`pnpm test:docker` runs it and then records the browser smoke test's answers, which is what a job with a Docker
daemon runs. The start script itself is also run under `pnpm test` without Docker, by `test/image.test.ts`, which
checks the files it writes.
