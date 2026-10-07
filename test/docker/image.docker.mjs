// The image as it runs: built, started in each gateway mode, and asked over HTTP for the headers the README promises.
// It needs a Docker daemon, so it is `pnpm test:docker` and never part of `pnpm test`. The file name keeps vitest from
// collecting it.
//
// Nothing is bind-mounted, because a daemon reached through a socket resolves a mount on its own filesystem rather
// than this process's. config.json is copied into each container before it starts, where a mount would place it.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { hostname, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const IMAGE = 'stream-event-client:test-docker';
const LABEL = 'stream-event-client-image-test';
const NETWORK = 'stream-event-client-image-test';
// An address, not a name, so nginx starts without a gateway to resolve. A read through /bee then fails upstream.
const GATEWAY = 'http://127.0.0.1:1633';
const CHAT_READ = 'https://chat-read.example.com';
const CHAT_WRITE = 'https://chat-write.example.com';
const CONFIG = JSON.stringify({ gatewayUrl: '/bee', catalog: { owner: `0x${'1'.repeat(40)}`, topic: 'image-test' } });

function docker(args, { allowFailure = false, timeoutMs } = {}) {
  const result = spawnSync('docker', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: timeoutMs });
  if (result.error) throw result.error;
  if (result.status !== 0 && !allowFailure) {
    throw new Error(
      `docker ${args.join(' ')} exited ${result.status}\n--- stdout\n${result.stdout}\n--- stderr\n${result.stderr}`,
    );
  }
  return result;
}

// The id of the container this process runs in, or null outside one the daemon knows.
function ownContainerId() {
  const candidates = [hostname()];
  try {
    const match = readFileSync('/proc/self/mountinfo', 'utf8').match(/\/containers\/([0-9a-f]{64})\//);
    if (match) candidates.push(match[1]);
  } catch {
    // not Linux, so not in a container this daemon started
  }
  return candidates.find((id) => docker(['container', 'inspect', id], { allowFailure: true }).status === 0) ?? null;
}

const self = ownContainerId();
let nextPort = 18080;

// Creates a container with the given settings and config.json in place, starts it, and returns its address.
function startContainer(name, env) {
  const port = nextPort++;
  const reach = self ? ['--network', NETWORK] : ['-p', `127.0.0.1:${port}:80`];
  const settings = Object.entries(env).flatMap(([key, value]) => ['-e', `${key}=${value}`]);
  docker(['create', '--label', LABEL, '--name', name, ...reach, ...settings, IMAGE]);
  const dir = mkdtempSync(join(tmpdir(), 'image-config-'));
  writeFileSync(join(dir, 'config.json'), CONFIG);
  docker(['cp', join(dir, 'config.json'), `${name}:/usr/share/nginx/html/config.json`]);
  docker(['start', name]);
  return self ? `http://${name}:80` : `http://127.0.0.1:${port}`;
}

async function waitForServer(url, name) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    try {
      await fetch(url, { signal: AbortSignal.timeout(2000) });
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
  const logs = docker(['logs', name], { allowFailure: true });
  throw new Error(`${name} never answered at ${url}\n${logs.stdout}\n${logs.stderr}`);
}

const get = (url, init = {}) => fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(10_000), ...init });

function removeAll() {
  const ids = docker(['container', 'ls', '-aq', '--filter', `label=${LABEL}`])
    .stdout.split('\n')
    .filter(Boolean);
  if (ids.length) docker(['container', 'rm', '-f', ...ids], { allowFailure: true });
  if (self) docker(['network', 'disconnect', '-f', NETWORK, self], { allowFailure: true });
  docker(['network', 'rm', NETWORK], { allowFailure: true });
}

// A file of the built bundle, read from the page itself, since its name is a content hash.
async function anAsset(base) {
  const html = await (await get(`${base}/`)).text();
  const match = html.match(/(?:src|href)="\.?\/?(assets\/[^"]+\.js)"/);
  assert.ok(match, `the page names no bundle file:\n${html}`);
  return match[1];
}

function policyOf(response) {
  const policy = response.headers.get('content-security-policy');
  assert.ok(policy, 'the answer carries a content security policy');
  return policy;
}

before(() => {
  removeAll();
  docker(['build', '--label', LABEL, '-t', IMAGE, ROOT]);
  if (self) {
    docker(['network', 'create', '--label', LABEL, NETWORK]);
    docker(['network', 'connect', NETWORK, self]);
  }
});

after(removeAll);

for (const mode of ['proxy', 'direct']) {
  void it(`passes nginx -t in ${mode} mode`, () => {
    const settings = ['-e', `GATEWAY_MODE=${mode}`, '-e', `BEE_GATEWAY_URL=${GATEWAY}`];
    const result = docker(['run', '--rm', '--label', LABEL, ...settings, IMAGE, 'nginx', '-t'], { allowFailure: true });
    assert.equal(result.status, 0, `nginx -t in ${mode} mode:\n${result.stdout}\n${result.stderr}`);
  });
}

void describe('proxy mode, the default', () => {
  let base;
  before(async () => {
    base = startContainer('image-test-proxy', {
      BEE_GATEWAY_URL: GATEWAY,
      CHAT_READ_URL: CHAT_READ,
      CHAT_WRITE_URL: CHAT_WRITE,
    });
    await waitForServer(base, 'image-test-proxy');
  });

  void it('serves the page no-cache, with the policy, at the root and at any app route', async () => {
    for (const path of ['/', '/watch/video/owner/topic']) {
      const response = await get(`${base}${path}`);
      assert.equal(response.status, 200, path);
      assert.match(response.headers.get('content-type') ?? '', /text\/html/, path);
      assert.equal(response.headers.get('cache-control'), 'no-cache', path);
      const policy = policyOf(response);
      assert.match(
        policy,
        /connect-src 'self' https:\/\/chat-read\.example\.com https:\/\/chat-write\.example\.com http:\/\/localhost:\* http:\/\/127\.0\.0\.1:\*/,
      );
      assert.doesNotMatch(policy, /127\.0\.0\.1:1633/, 'a proxied gateway is on the page own origin');
      assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
    }
  });

  void it('serves the mounted config.json no-store', async () => {
    const response = await get(`${base}/config.json`);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    policyOf(response);
    assert.deepEqual(await response.json(), JSON.parse(CONFIG));
  });

  void it('keeps the hashed bundle for a year, and answers a missing asset 404', async () => {
    const response = await get(`${base}/${await anAsset(base)}`);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'public, max-age=31536000, immutable');
    policyOf(response);
    assert.equal((await get(`${base}/assets/not-there.js`)).status, 404);
  });

  void it('forwards reads at /bee to the gateway and refuses writes', async () => {
    // Nothing listens at the gateway address, so a forwarded read fails upstream rather than serving the page.
    assert.equal((await get(`${base}/bee/health`)).status, 502);
    const write = await get(`${base}/bee/soc/${'a'.repeat(40)}/${'b'.repeat(64)}`, { method: 'POST', body: 'x' });
    assert.equal(write.status, 403);
  });
});

void describe('direct mode', () => {
  let base;
  before(async () => {
    base = startContainer('image-test-direct', {
      GATEWAY_MODE: 'direct',
      BEE_GATEWAY_URL: 'https://gateway.example.com',
    });
    await waitForServer(base, 'image-test-direct');
  });

  void it('lets the page reach the gateway itself', async () => {
    const policy = policyOf(await get(`${base}/`));
    assert.match(policy, /connect-src 'self' https:\/\/gateway\.example\.com /);
    assert.match(policy, /img-src [^;]*https:\/\/gateway\.example\.com/);
  });

  void it('serves no /bee, rather than the page', async () => {
    const response = await get(`${base}/bee/health`);
    assert.equal(response.status, 404);
    assert.doesNotMatch(await response.text(), /<div id="root">/);
  });
});

void describe('BEE_NODES=https-and-local-http', () => {
  let base;
  before(async () => {
    base = startContainer('image-test-bee-nodes', {
      BEE_GATEWAY_URL: GATEWAY,
      BEE_NODES: 'https-and-local-http',
    });
    await waitForServer(base, 'image-test-bee-nodes');
  });

  void it('lets the page reach a Bee node at any https or plain http address', async () => {
    const policy = policyOf(await get(`${base}/`));
    assert.match(policy, /img-src [^;]* https: http:;/);
    assert.match(policy, /connect-src [^;]* https: http:;/);
    assert.match(policy, /media-src 'self' blob:;/);
  });
});

void it('refuses to start on an unknown BEE_NODES, and says why', () => {
  const settings = ['-e', `BEE_GATEWAY_URL=${GATEWAY}`, '-e', 'BEE_NODES=lan'];
  const result = docker(['run', '--rm', '--label', LABEL, ...settings, IMAGE], {
    allowFailure: true,
    timeoutMs: 60_000,
  });
  assert.equal(result.signal, null, 'the container kept running with BEE_NODES=lan');
  assert.notEqual(result.status, 0, 'the container stopped');
  assert.match(`${result.stdout}\n${result.stderr}`, /BEE_NODES must be off, https or https-and-local-http/);
});

void it('refuses to start without BEE_GATEWAY_URL, and says why', () => {
  // A container that started anyway would serve for ever, so the wait is bounded and a timeout reads as a failure.
  const result = docker(['run', '--rm', '--label', LABEL, IMAGE], { allowFailure: true, timeoutMs: 60_000 });
  assert.equal(result.signal, null, 'the container kept running without BEE_GATEWAY_URL');
  assert.notEqual(result.status, 0, 'the container stopped');
  assert.match(`${result.stdout}\n${result.stderr}`, /BEE_GATEWAY_URL is not set/);
});
