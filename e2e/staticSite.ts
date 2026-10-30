import { existsSync, readFileSync, statSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { extname, join, normalize } from 'node:path';

const TYPES: Record<string, string> = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.wasm': 'application/wasm',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
};

export interface StaticSite {
  readonly origin: string;
  close(): Promise<void>;
}

/**
 * The built app served the way a host that sets no headers of its own serves it, such as an ENS gateway or a Bee
 * node: each file with its type, the page for any other path, and nothing else. `vite preview` sends weeb-3's service
 * worker with `Service-Worker-Allowed`, which such a host never does.
 */
export async function serveWithoutHeaders(dist: string): Promise<StaticSite> {
  const server: Server = createServer((request, response) => {
    const path = normalize(decodeURIComponent((request.url ?? '/').split('?')[0]));
    const asked = join(dist, path);
    const file =
      !path.startsWith('..') && existsSync(asked) && statSync(asked).isFile() ? asked : join(dist, 'index.html');
    response.setHeader('Content-Type', TYPES[extname(file)] ?? 'application/octet-stream');
    response.end(readFileSync(file));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    origin: `http://127.0.0.1:${port}`,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}
