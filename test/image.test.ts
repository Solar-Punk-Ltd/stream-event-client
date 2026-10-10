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
  weeb3: string;
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
    weeb3: read('weeb3.conf'),
  };
}

function escape(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function policy(headers: string): string {
  const match = headers.match(/Content-Security-Policy "([^"]+)"/);
  if (!match) throw new Error(`no policy in:\n${headers}`);
  return match[1];
}

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

  it('lets the page reach the gateway itself in direct mode, and serves no /bee', () => {
    const started = start({ GATEWAY_MODE: 'direct', BEE_GATEWAY_URL: 'https://gateway.example.com' });
    expect(started.status).toBe(0);
    expect(started.gateway).toContain('return 404;');
    expect(started.gateway).not.toContain('proxy_pass');
    expect(policy(started.headers)).toMatch(/connect-src 'self' https:\/\/gateway\.example\.com /);
    expect(policy(started.headers)).toMatch(/img-src [^;]*https:\/\/gateway\.example\.com/);
  });

  it('allows both chat endpoints, a node on the viewer own machine, and blob media', () => {
    const csp = policy(
      start({
        BEE_GATEWAY_URL: 'http://gateway:1633',
        CHAT_READ_URL: 'https://chat-read.example.com',
        CHAT_WRITE_URL: 'https://chat-write.example.com/',
      }).headers,
    );
    expect(csp).toMatch(/connect-src [^;]*https:\/\/chat-read\.example\.com https:\/\/chat-write\.example\.com /);
    expect(csp).toMatch(/connect-src [^;]*http:\/\/localhost:\* http:\/\/127\.0\.0\.1:\*/);
    expect(csp).toContain("media-src 'self' blob:");
    expect(csp).toContain("worker-src 'self' blob:");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("script-src 'self';");
  });

  it('keeps exactly the policy it had before when no extra gateway is named', () => {
    expect(policy(start({ GATEWAY_MODE: 'direct', BEE_GATEWAY_URL: 'https://gateway.example.com' }).headers)).toBe(
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self'; manifest-src 'self'" +
        "; img-src 'self' data: blob: https://gateway.example.com http://localhost:* http://127.0.0.1:*" +
        "; media-src 'self' blob:; worker-src 'self' blob:" +
        "; connect-src 'self' https://gateway.example.com http://localhost:* http://127.0.0.1:*" +
        "; object-src 'none'; base-uri 'self'; form-action 'none'; frame-ancestors 'none'",
    );
  });

  it.each(['proxy', 'direct'])('lets the page reach every extra gateway in %s mode, by its origin', (mode) => {
    const started = start({
      GATEWAY_MODE: mode,
      BEE_GATEWAY_URL: 'https://gateway.example.com',
      EXTRA_GATEWAY_URLS: ' https://second.example.com/  http://third.example.com:1633 ',
    });
    expect(started.status).toBe(0);
    const csp = policy(started.headers);
    const extras = 'https://second.example.com http://third.example.com:1633';
    expect(csp).toMatch(new RegExp(`connect-src [^;]*${escape(extras)}`));
    expect(csp).toMatch(new RegExp(`img-src [^;]*${escape(extras)}`));
    // hls.js plays through blob URLs, so no gateway, the main one included, is a media source.
    expect(csp).toContain("media-src 'self' blob:;");
    expect(started.stdout).toContain(`extra gateways ${extras}`);
  });

  describe('BEE_NODES, which Bee nodes a viewer may pick', () => {
    const OWN_MACHINE = 'http://localhost:* http://127.0.0.1:*';
    const sources = (csp: string, directive: string) =>
      (csp.split('; ').find((part) => part.startsWith(`${directive} `)) ?? '').split(' ').slice(1);

    it.each([
      ['unset', {}],
      ['off', { BEE_NODES: 'off' }],
    ])('allows only nodes on the viewer own machine when %s', (_, settings) => {
      const started = start({ GATEWAY_MODE: 'direct', BEE_GATEWAY_URL: 'https://gateway.example.com', ...settings });
      expect(started.status).toBe(0);
      const csp = policy(started.headers);
      for (const directive of ['img-src', 'connect-src']) {
        expect(csp).toMatch(new RegExp(`${directive} [^;]*${escape(OWN_MACHINE)};`));
        expect(sources(csp, directive)).not.toContain('https:');
        expect(sources(csp, directive)).not.toContain('http:');
      }
      expect(started.stdout).not.toContain('Bee nodes');
    });

    it.each([
      ['https', ['https:']],
      ['https-and-local-http', ['https:', 'http:']],
    ])('at %s adds the scheme sources to img-src and connect-src, and nowhere else', (level, schemes) => {
      const started = start({ BEE_GATEWAY_URL: 'https://gateway.example.com', BEE_NODES: level });
      expect(started.status).toBe(0);
      const csp = policy(started.headers);
      for (const directive of ['img-src', 'connect-src']) {
        expect(csp).toMatch(new RegExp(`${directive} [^;]*${escape(OWN_MACHINE)} ${escape(schemes.join(' '))};`));
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
        expect(sources(csp, directive)).not.toContain('http:');
      }
      expect(sources(csp, 'connect-src')).not.toContain('blob:');
      expect(started.stdout).toContain(`Bee nodes ${level}`);
    });

    it('writes no file when the level is unknown', () => {
      const started = start({ BEE_GATEWAY_URL: 'https://gateway.example.com', BEE_NODES: 'lan' });
      expect(started.status).not.toBe(0);
      expect(started.gateway).toBe('');
      expect(started.headers).toBe('');
    });

    it('writes exactly this policy at https-and-local-http', () => {
      const started = start({
        GATEWAY_MODE: 'direct',
        BEE_GATEWAY_URL: 'https://gateway.example.com',
        BEE_NODES: 'https-and-local-http',
      });
      expect(policy(started.headers)).toBe(
        "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self'; manifest-src 'self'" +
          "; img-src 'self' data: blob: https://gateway.example.com http://localhost:* http://127.0.0.1:* https: http:" +
          "; media-src 'self' blob:; worker-src 'self' blob:" +
          "; connect-src 'self' https://gateway.example.com http://localhost:* http://127.0.0.1:* https: http:" +
          "; object-src 'none'; base-uri 'self'; form-action 'none'; frame-ancestors 'none'",
      );
    });
  });

  describe('WEEB3, whether a viewer may run the node in the browser', () => {
    const sources = (csp: string, directive: string) =>
      (csp.split('; ').find((part) => part.startsWith(`${directive} `)) ?? '').split(' ').slice(1);

    it.each([
      ['unset', {}],
      ['off', { WEEB3: 'off' }],
    ])('leaves the policy as it was and serves no /weeb-3/ when %s', (_, settings) => {
      const started = start({ GATEWAY_MODE: 'direct', BEE_GATEWAY_URL: 'https://gateway.example.com', ...settings });
      expect(started.status).toBe(0);
      const csp = policy(started.headers);
      expect(sources(csp, 'script-src')).toEqual(["'self'"]);
      expect(sources(csp, 'connect-src')).not.toContain('wss:');
      expect(started.weeb3).toContain('location /weeb-3/ {\n  return 404;\n}');
      expect(started.stdout).not.toContain('weeb-3');
    });

    it('lets the page compile WebAssembly and reach peers over secure websockets when on, and nothing else', () => {
      const started = start({ GATEWAY_MODE: 'direct', BEE_GATEWAY_URL: 'https://gateway.example.com', WEEB3: 'on' });
      expect(started.status).toBe(0);
      expect(policy(started.headers)).toBe(
        "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; font-src 'self'; manifest-src 'self'" +
          "; img-src 'self' data: blob: https://gateway.example.com http://localhost:* http://127.0.0.1:*" +
          "; media-src 'self' blob:; worker-src 'self' blob:" +
          "; connect-src 'self' https://gateway.example.com http://localhost:* http://127.0.0.1:* wss:" +
          "; object-src 'none'; base-uri 'self'; form-action 'none'; frame-ancestors 'none'",
      );
      expect(started.stdout).toContain('weeb-3 on');
    });

    it("serves weeb-3's files with the WebAssembly type, and its service worker allowed to control the whole site", () => {
      const { weeb3 } = start({ BEE_GATEWAY_URL: 'https://gateway.example.com', WEEB3: 'on' });
      expect(weeb3).toContain('location /weeb-3/ {');
      expect(weeb3).toContain('application/wasm wasm;');
      expect(weeb3).toContain('try_files $uri =404;');
      const worker = weeb3.slice(weeb3.indexOf('location = /weeb-3/service.js {'));
      expect(worker).toContain('add_header Service-Worker-Allowed "/" always;');
      expect(worker).toContain('include /etc/nginx/stream-event-client/headers.conf;');
    });
  });

  it.each([
    [{ BEE_GATEWAY_URL: 'https://gateway.example.com', WEEB3: 'yes' }, 'WEEB3 must be off or on. It is "yes".'],
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
      { BEE_GATEWAY_URL: 'https://gateway.example.com', BEE_NODES: 'lan' },
      'BEE_NODES must be off, https or https-and-local-http. It is "lan".',
    ],
    [{ BEE_GATEWAY_URL: 'https://gateway.example.com', BEE_NODES: 'HTTPS' }, 'BEE_NODES must be off, https'],
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

  it("compresses weeb-3's WebAssembly module and scripts, which /weeb-3/ serves under their own types", () => {
    const types = SERVER.match(/gzip_types ([^;]+);/)?.[1].split(' ') ?? [];

    expect(types).toEqual(expect.arrayContaining(['application/wasm', 'text/javascript', 'application/javascript']));
  });

  it('includes what the start-up script writes for weeb-3', () => {
    expect(SERVER).toContain('include /etc/nginx/stream-event-client/weeb3.conf;');
  });

  it('repeats the security headers in every location that sets a header of its own', () => {
    for (const opening of ['location = /index.html', 'location = /config.json', 'location /assets/']) {
      expect(location(opening)).toContain('include /etc/nginx/stream-event-client/headers.conf;');
    }
  });
});
