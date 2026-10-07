import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const SRC = join(ROOT, 'src');
const SWARM = join(SRC, 'swarm');

/** The folders the Swarm layer must not reach into, so the features depend on it and never the other way. */
const FORBIDDEN = ['app', 'features'].map((folder) => join(SRC, folder));

/** `import ... from 'x'`, `export ... from 'x'`, `import 'x'` and `import('x')`, type-only ones included. */
const SPECIFIERS = /(?:\bfrom\s*|\bimport\s*\(?\s*)['"]([^'"]+)['"]/g;

function sourceFiles(folder: string): string[] {
  return readdirSync(folder, { withFileTypes: true }).flatMap((entry) => {
    const path = join(folder, entry.name);
    if (entry.isDirectory()) {
      return sourceFiles(path);
    }
    return /\.tsx?$/.test(entry.name) ? [path] : [];
  });
}

/** Where a specifier points inside the repository, or null for a package. */
function resolvedPath(specifier: string, importer: string): string | null {
  if (specifier.startsWith('@/')) {
    return join(SRC, specifier.slice(2));
  }
  return specifier.startsWith('.') ? resolve(dirname(importer), specifier) : null;
}

function forbiddenImportsOf(file: string): string[] {
  const source = readFileSync(file, 'utf8');
  return [...source.matchAll(SPECIFIERS)]
    .map(([, specifier]) => specifier)
    .filter((specifier) => {
      const target = resolvedPath(specifier, file);
      return target !== null && FORBIDDEN.some((folder) => target === folder || target.startsWith(`${folder}/`));
    })
    .map((specifier) => `${relative(ROOT, file)} imports ${specifier}`);
}

describe('the Swarm layer', () => {
  it('imports nothing from src/app or src/features', () => {
    const files = sourceFiles(SWARM);

    expect(files.length).toBeGreaterThan(0);
    expect(files.flatMap(forbiddenImportsOf)).toEqual([]);
  });
});

/** The folders the features and the app live in, which reach Swarm only through the client. */
const READERS_OF_SWARM = ['app', 'features'].map((folder) => join(SRC, folder));

/**
 * What reaching Swarm directly looks like in a source line: a gateway joined onto a Bee path, a call
 * of the global fetch or of the app's bounded fetch, a Bee client of its own, and the two ways a page
 * loads a URL without fetch. A method that is merely named `fetch` is not one.
 */
const DIRECT_SWARM_ACCESS: readonly { readonly what: string; readonly pattern: RegExp }[] = [
  { what: 'builds a Bee URL', pattern: /\$\{[^}]+\}\/(?:feeds|soc|chunks|bytes|bzz|health)\b/ },
  { what: 'calls fetch', pattern: /(?:^|[^.\w])fetch\s*\(|\b(?:window|globalThis|self)\s*\.\s*fetch\s*\(/ },
  { what: 'uses the bounded fetch', pattern: /\bfetchWithTimeout\b/ },
  { what: 'makes a Bee client', pattern: /\bnew\s+Bee\s*\(/ },
  { what: 'loads a URL by hand', pattern: /\bXMLHttpRequest\b|\bnew\s+Image\s*\(/ },
];

/** A line with its module specifiers and method definitions taken out, which name things rather than call them. */
function codeOf(line: string): string {
  return line.replace(/(?:\bfrom\s*|\bimport\s*\(?\s*)['"][^'"]+['"]/g, '').replace(/\basync\s+fetch\s*\(/g, '');
}

function directAccessIn(file: string): string[] {
  return readFileSync(file, 'utf8')
    .split('\n')
    .flatMap((line, at) =>
      DIRECT_SWARM_ACCESS.filter(({ pattern }) => pattern.test(codeOf(line))).map(
        ({ what }) => `${relative(ROOT, file)}:${at + 1} ${what}: ${line.trim()}`,
      ),
    );
}

describe('the features and the app', () => {
  it('read Swarm only through the Swarm client, never by URL or fetch of their own', () => {
    const files = READERS_OF_SWARM.flatMap(sourceFiles);

    expect(files.length).toBeGreaterThan(0);
    expect(files.flatMap(directAccessIn)).toEqual([]);
  });

  it.each([
    ['const url = `${gatewayUrl}/bytes/${reference}`;', 'builds a Bee URL'],
    ['return `${this.base}/feeds/${owner}/${topic}`;', 'builds a Bee URL'],
    ['const response = await fetch(url);', 'calls fetch'],
    ['await window.fetch(url)', 'calls fetch'],
    ['const res = await fetchWithTimeout(url, { signal });', 'uses the bounded fetch'],
    ["import { fetchWithTimeout } from '@/shared/fetchWithTimeout';", 'uses the bounded fetch'],
    ['const bee = new Bee(url);', 'makes a Bee client'],
    ['const picture = new Image();', 'loads a URL by hand'],
  ])('catches %s', (line, what) => {
    expect(DIRECT_SWARM_ACCESS.filter(({ pattern }) => pattern.test(codeOf(line))).map((rule) => rule.what)).toEqual([
      what,
    ]);
  });

  it.each([
    'async fetch(url: string): Promise<string> {',
    'manifestFetcher.fetch(context.url)',
    "import { FetchTimeoutError } from '@/shared/fetchWithTimeout';",
    "if (uri.startsWith('/bytes/')) {",
  ])('leaves alone %s', (line) => {
    expect(DIRECT_SWARM_ACCESS.filter(({ pattern }) => pattern.test(codeOf(line)))).toEqual([]);
  });
});
