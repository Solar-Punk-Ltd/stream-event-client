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

  it.each([
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

  it('repeats the security headers in every location that sets a header of its own', () => {
    for (const opening of ['location = /index.html', 'location = /config.json', 'location /assets/']) {
      expect(location(opening)).toContain('include /etc/nginx/stream-event-client/headers.conf;');
    }
  });
});
