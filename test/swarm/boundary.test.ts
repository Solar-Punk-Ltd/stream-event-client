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
