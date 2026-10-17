import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { extname, join, normalize } from 'node:path';

import { build } from 'vite';

import { KIT_DIR } from './paths.ts';

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json',
  '.wasm': 'application/wasm',
};

/** The hostile site served from this machine, until closed. */
export interface EvilSite {
  origin: string;
  close(): Promise<void>;
}

/**
 * Builds the hostile site against the Swarm ID library this checkout installs, which `kit.lock.json` pins, and serves
 * it at `origin` from the kit's own process, as the local stack's container serves it: no policy of its own, any site
 * may fetch it, and every path falls back to its page. Live mode uses it, since the hostile site is the one part of a
 * live run that is never the deployment's.
 */
export async function serveEvilSite(origin: string): Promise<EvilSite> {
  const url = new URL(origin);
  const outDir = mkdtempSync(join(tmpdir(), 'flow-kit-evil-'));
  await build({
    configFile: join(KIT_DIR, 'evil', 'vite.config.ts'),
    logLevel: 'warn',
    build: { outDir, emptyOutDir: true },
  });
  const page = join(outDir, 'index.html');
  const server = createServer((request, response) => {
    const path = normalize(decodeURIComponent(new URL(request.url ?? '/', origin).pathname)).replace(
      /^(\.\.[/\\])+/,
      '',
    );
    const file = join(outDir, path);
    const served = file.startsWith(outDir) && existsSync(file) && statSync(file).isFile() ? file : page;
    response.writeHead(200, {
      'content-type': TYPES[extname(served)] ?? 'application/octet-stream',
      'access-control-allow-origin': '*',
    });
    response.end(readFileSync(served));
  });
  const host = url.hostname.replace(/^\[|\]$/g, '');
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(Number(url.port), host, resolve);
  });
  return {
    origin,
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
        server.closeAllConnections();
        rmSync(outDir, { recursive: true, force: true });
      }),
  };
}
