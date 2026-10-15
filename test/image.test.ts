import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const START_SCRIPT = join(ROOT, 'deploy/nginx/40-gateway-and-policy.sh');
const SERVER = readFileSync(join(ROOT, 'deploy/nginx/default.conf'), 'utf8');

interface Start {
  status: number | null;
  stdout: string;
  stderr: string;
  gateway: string;
  headers: string;
  fonts: string;
}

/** Runs the image's start-up script with only the given settings, writing into a folder of its own. */
function start(settings: Record<string, string>): Start {
  const dir = mkdtempSync(join(tmpdir(), 'image-start-'));
  const result = spawnSync('sh', [START_SCRIPT], {
    encoding: 'utf8',
    env: { PATH: process.env.PATH, STREAM_CLIENT_NGINX_DIR: dir, ...settings },
  });
  const read = (file: string) => {
    try {
      return readFileSync(join(dir, file), 'utf8');
    } catch {
      return '';
    }
  };
  return {
    status: result.status,
    stdout: result.stdout,
    stderr: result.stderr,
    gateway: read('gateway.conf'),
    headers: read('headers.conf'),
    fonts: read('fonts.conf'),
  };
}

function policy(headers: string): string {
  const match = headers.match(/Content-Security-Policy "([^"]+)"/);
  if (!match) throw new Error(`no policy in:\n${headers}`);
  return match[1];
}

/** The sources one directive of a policy lists. */
const sources = (csp: string, directive: string) =>
  (csp.split('; ').find((part) => part.startsWith(`${directive} `)) ?? '').split(' ').slice(1);

/** What the policy is with nothing beyond the gateway set, the one every deployment starts from. */
const BASE_POLICY =
  "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; font-src 'self'; manifest-src 'self'" +
  "; img-src 'self' data: blob: https: http://localhost:* http://127.0.0.1:*" +
  "; media-src 'self' blob:; worker-src 'self' blob:" +
  "; connect-src 'self' https: wss: http://localhost:* http://127.0.0.1:*" +
  "; object-src 'none'; base-uri 'self'; form-action 'none'; frame-ancestors 'none'";

/** The body of the server block's location whose opening line is exactly `opening`. */
function location(opening: string): string {
  const start = SERVER.indexOf(`${opening} {`);
  expect(start, `default.conf has no ${opening} block`).not.toBe(-1);
  return SERVER.slice(start, SERVER.indexOf('}', start));
}

describe('the image start-up script', () => {
  it('forwards /bee to the gateway for reads only in proxy mode, the default', () => {
    const started = start({ BEE_GATEWAY_URL: 'https://gateway.example.com/' });
    expect(started.status).toBe(0);
    expect(started.gateway).toContain('proxy_pass https://gateway.example.com/;');
    expect(started.gateway).toContain('limit_except GET { deny all; }');
    expect(policy(started.headers)).not.toContain('gateway.example.com');
  });

  it('serves no /bee in direct mode, where the page reads an https gateway as it reads any https address', () => {
    const started = start({ GATEWAY_MODE: 'direct', BEE_GATEWAY_URL: 'https://gateway.example.com' });
    expect(started.status).toBe(0);
    expect(started.gateway).toContain('return 404;');
    expect(started.gateway).not.toContain('proxy_pass');
    expect(policy(started.headers)).toBe(BASE_POLICY);
  });

  it('names a plain http gateway in direct mode, which https: does not cover', () => {
    const csp = policy(start({ GATEWAY_MODE: 'direct', BEE_GATEWAY_URL: 'http://gateway.example.com:1633' }).headers);
    expect(sources(csp, 'connect-src')).toContain('http://gateway.example.com:1633');
    expect(sources(csp, 'img-src')).toContain('http://gateway.example.com:1633');
  });

  it('is the same policy for every deployment, whatever kinds of source a viewer adds', () => {
    expect(policy(start({ BEE_GATEWAY_URL: 'https://gateway.example.com' }).headers)).toBe(BASE_POLICY);
  });

  describe('the sources the page offers a viewer, each allowed by the policy', () => {
    const csp = policy(start({ BEE_GATEWAY_URL: 'https://gateway.example.com' }).headers);

    it('any gateway at an https address, read and its pictures shown', () => {
      expect(sources(csp, 'connect-src')).toContain('https:');
      expect(sources(csp, 'img-src')).toContain('https:');
    });

    it('a Bee node on the viewer own machine at any port, over plain http', () => {
      for (const directive of ['connect-src', 'img-src']) {
        expect(sources(csp, directive)).toEqual(expect.arrayContaining(['http://localhost:*', 'http://127.0.0.1:*']));
      }
    });

    it('weeb-3, which compiles WebAssembly and reaches its peers over secure websockets', () => {
      expect(sources(csp, 'script-src')).toEqual(["'self'", "'wasm-unsafe-eval'"]);
      expect(sources(csp, 'connect-src')).toContain('wss:');
    });

    it('no plain http beyond this machine, no script from elsewhere, and blob URLs only as media, images and workers', () => {
      for (const directive of ['connect-src', 'img-src']) {
        expect(sources(csp, directive)).not.toContain('http:');
      }
      for (const directive of [
        'default-src',
        'script-src',
        'style-src',
        'font-src',
        'manifest-src',
        'media-src',
        'worker-src',
      ]) {
        expect(sources(csp, directive)).not.toContain('https:');
      }
      expect(sources(csp, 'connect-src')).not.toContain('blob:');
      expect(sources(csp, 'media-src')).toEqual(["'self'", 'blob:']);
    });
  });

  it('names a plain http chat endpoint, and leaves an https one to https:', () => {
    const csp = policy(
      start({
        BEE_GATEWAY_URL: 'http://gateway:1633',
        CHAT_READ_URL: 'https://chat-read.example.com',
        CHAT_WRITE_URL: 'http://chat-write.example.com:1633/',
      }).headers,
    );
    expect(sources(csp, 'connect-src')).toContain('http://chat-write.example.com:1633');
    expect(csp).not.toContain('chat-read.example.com');
  });

  it.each(['proxy', 'direct'])(
    'names the plain http extra gateways in %s mode, and leaves the https ones to https:',
    (mode) => {
      const started = start({
        GATEWAY_MODE: mode,
        BEE_GATEWAY_URL: 'https://gateway.example.com',
        EXTRA_GATEWAY_URLS: ' https://second.example.com/  http://third.example.com:1633 ',
      });
      expect(started.status).toBe(0);
      const csp = policy(started.headers);
      for (const directive of ['connect-src', 'img-src']) {
        expect(sources(csp, directive)).toContain('http://third.example.com:1633');
      }
      expect(csp).not.toContain('second.example.com');
      expect(started.stdout).toContain('extra gateways https://second.example.com http://third.example.com:1633');
    },
  );

  it.each([
    ['BEE_NODES', 'https-and-local-http'],
    ['WEEB3', 'off'],
  ])('reads no %s, since the page decides what it offers', (setting, value) => {
    const started = start({ BEE_GATEWAY_URL: 'https://gateway.example.com', [setting]: value });
    expect(started.status).toBe(0);
    expect(policy(started.headers)).toBe(BASE_POLICY);
  });

  describe('SWARM_ID_URL, the Swarm ID site config.json names as swarmId.url', () => {
    it('lets the page frame that one site and nothing else, and adds it to no other directive', () => {
      const started = start({
        BEE_GATEWAY_URL: 'https://gateway.example.com',
        SWARM_ID_URL: 'https://id.example.com/',
      });
      expect(started.status).toBe(0);
      const csp = policy(started.headers);
      expect(csp).toContain('; frame-src https://id.example.com;');
      expect(csp.split('; ').filter((part) => part.includes('id.example.com'))).toEqual([
        'frame-src https://id.example.com',
      ]);
      expect(started.stdout).toContain('Swarm ID https://id.example.com');
    });

    it('keeps exactly the policy it had before when it is not set', () => {
      const csp = policy(start({ BEE_GATEWAY_URL: 'https://gateway.example.com' }).headers);
      expect(csp).not.toContain('frame-src');
    });

    it("lets that one site read /bee from its frame, for GET and its preflight alone, with the gateway's own CORS headers replaced", () => {
      const started = start({
        BEE_GATEWAY_URL: 'https://gateway.example.com',
        SWARM_ID_URL: 'https://id.example.com/',
      });
      expect(started.status).toBe(0);
      const bee = started.gateway;

      expect(bee).toContain('add_header Access-Control-Allow-Origin "https://id.example.com" always;');
      expect(bee).not.toMatch(/Access-Control-Allow-Origin "\*"/);
      expect(bee).toContain('proxy_hide_header Access-Control-Allow-Origin;');
      expect(bee, 'limit_except is chosen before the preflight answer runs, so OPTIONS must pass it').toContain(
        'limit_except GET OPTIONS { deny all; }',
      );
      expect(bee).toContain('include /etc/nginx/stream-event-client/headers.conf;');

      const preflight = bee.slice(bee.indexOf('if ($request_method = OPTIONS) {'));
      expect(preflight, 'a preflight is answered here, never forwarded').toContain('return 204;');
      expect(preflight).toContain('add_header Access-Control-Allow-Origin "https://id.example.com" always;');
      expect(preflight).toContain('add_header Access-Control-Allow-Methods "GET" always;');
      expect(preflight).toContain(
        'add_header Access-Control-Allow-Headers $http_access_control_request_headers always;',
      );
    });

    it("lets that one site, and no other, fetch the page's font files, which Swarm ID's button loads in its frame", () => {
      for (const mode of ['proxy', 'direct']) {
        const started = start({
          GATEWAY_MODE: mode,
          BEE_GATEWAY_URL: 'https://gateway.example.com',
          SWARM_ID_URL: 'https://id.example.com/',
        });
        expect(started.status, mode).toBe(0);
        expect(started.fonts.match(/^\s*add_header .*$/gm), mode).toEqual([
          'add_header Access-Control-Allow-Origin "https://id.example.com" always;',
        ]);
      }
    });

    it('adds no CORS header to the font files when it is not set', () => {
      const started = start({ BEE_GATEWAY_URL: 'https://gateway.example.com' });
      expect(started.status).toBe(0);
      expect(started.fonts).not.toContain('Access-Control');
      expect(started.fonts).not.toMatch(/^\s*add_header/m);
    });

    it('adds no CORS header to /bee when it is not set, and has no /bee to add one to in direct mode', () => {
      expect(start({ BEE_GATEWAY_URL: 'https://gateway.example.com' }).gateway).not.toContain('Access-Control');
      const direct = start({
        GATEWAY_MODE: 'direct',
        BEE_GATEWAY_URL: 'https://gateway.example.com',
        SWARM_ID_URL: 'https://id.example.com',
      });
      expect(direct.gateway).not.toContain('Access-Control');
      expect(direct.gateway).toContain('return 404;');
    });
  });

  it.each([
    [
      { BEE_GATEWAY_URL: 'https://gateway.example.com', SWARM_ID_URL: 'https://id.example.com/proxy' },
      'SWARM_ID_URL must be an address',
    ],
    [{}, 'BEE_GATEWAY_URL is not set'],
    [{ BEE_GATEWAY_URL: 'gateway.example.com' }, 'BEE_GATEWAY_URL must be an address'],
    [{ BEE_GATEWAY_URL: 'https://gateway.example.com/bee' }, 'BEE_GATEWAY_URL must be an address'],
    [
      { BEE_GATEWAY_URL: 'https://gateway.example.com', CHAT_READ_URL: 'https://chat.example.com/x y' },
      'CHAT_READ_URL must be an address',
    ],
    [
      { BEE_GATEWAY_URL: 'https://gateway.example.com', CHAT_WRITE_URL: 'chat.example.com' },
      'CHAT_WRITE_URL must be an address',
    ],
    [
      { BEE_GATEWAY_URL: 'https://gateway.example.com', CHAT_BEE_URL: 'https://chat.example.com' },
      'CHAT_BEE_URL is replaced by CHAT_READ_URL and CHAT_WRITE_URL',
    ],
    [{ BEE_GATEWAY_URL: 'https://gateway.example.com', GATEWAY_MODE: 'both' }, 'GATEWAY_MODE must be proxy or direct'],
    [
      { BEE_GATEWAY_URL: 'https://gateway.example.com', EXTRA_GATEWAY_URLS: 'https://second.example.com second' },
      'EXTRA_GATEWAY_URLS must be an address such as https://gateway.example.com, with no path. It is "second".',
    ],
    [
      { BEE_GATEWAY_URL: 'https://gateway.example.com', EXTRA_GATEWAY_URLS: 'https://second.example.com/bee' },
      'EXTRA_GATEWAY_URLS must be an address',
    ],
    [
      { BEE_GATEWAY_URL: 'https://gateway.example.com', EXTRA_GATEWAY_URLS: 'ftp://second.example.com' },
      'EXTRA_GATEWAY_URLS must be an address',
    ],
    // grep tests each line on its own, so a second line must be refused before the pattern sees the value.
    [{ BEE_GATEWAY_URL: 'https://gateway.example.com\nhttps://other.example.com' }, 'BEE_GATEWAY_URL must be one'],
    [
      { BEE_GATEWAY_URL: 'https://gateway.example.com', CHAT_READ_URL: 'https://chat.example.com\r' },
      'CHAT_READ_URL must be one',
    ],
    [
      { BEE_GATEWAY_URL: 'https://gateway.example.com', SWARM_ID_URL: 'https://id.example.com\nhttps://x.example.com' },
      'SWARM_ID_URL must be one',
    ],
  ])('refuses to start on %j', (settings, reason) => {
    const started = start(settings);
    expect(started.status).not.toBe(0);
    expect(started.stderr).toContain(reason);
  });
});

describe('the image server', () => {
  it('serves the page for every app route and keeps it only after asking', () => {
    expect(location('location /')).toContain('try_files $uri $uri/ /index.html;');
    expect(location('location = /index.html')).toContain('Cache-Control "no-cache"');
  });

  it('never keeps config.json, and keeps the hashed bundle for a year', () => {
    expect(location('location = /config.json')).toContain('Cache-Control "no-store"');
    expect(location('location /assets/')).toContain('max-age=31536000, immutable');
  });

  it("serves the bundle's font files as the rest of the bundle, with the CORS header the start-up script writes for them", () => {
    const fonts = location('location ~ \\.woff2$');
    expect(location('location /assets/')).toContain('location ~ \\.woff2$');
    expect(fonts).toContain('include /etc/nginx/stream-event-client/headers.conf;');
    expect(fonts).toContain('include /etc/nginx/stream-event-client/fonts.conf;');
    expect(fonts).toContain('max-age=31536000, immutable');
    expect(fonts).toContain('try_files $uri =404;');
  });

  it("compresses weeb-3's WebAssembly module and scripts, which /weeb-3/ serves under their own types", () => {
    const types = SERVER.match(/gzip_types ([^;]+);/)?.[1].split(' ') ?? [];

    expect(types).toEqual(expect.arrayContaining(['application/wasm', 'text/javascript', 'application/javascript']));
  });

  it("always serves weeb-3's files with the WebAssembly type, never the page, and its worker allowed the whole site", () => {
    const files = SERVER.slice(
      SERVER.indexOf('location /weeb-3/ {'),
      SERVER.indexOf('location = /weeb-3/service.js {'),
    );
    expect(files).toContain('application/wasm wasm;');
    expect(files).toContain('try_files $uri =404;');
    expect(files).toContain('Cache-Control "no-cache"');
    expect(files).toContain('include /etc/nginx/stream-event-client/headers.conf;');
    expect(location('location = /weeb-3/service.js')).toContain('add_header Service-Worker-Allowed "/" always;');
  });

  it('repeats the security headers in every location that sets a header of its own', () => {
    for (const opening of [
      'location = /index.html',
      'location = /config.json',
      'location /assets/',
      'location = /weeb-3/service.js',
    ]) {
      expect(location(opening)).toContain('include /etc/nginx/stream-event-client/headers.conf;');
    }
  });
});
