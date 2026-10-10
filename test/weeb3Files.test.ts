import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { copyWeeb3Files, WEEB3_FILES, withServedWasmPath } from '../scripts/weeb3-files.mjs';

const made: string[] = [];

function folder(): string {
  const dir = mkdtempSync(join(tmpdir(), 'weeb3-files-'));
  made.push(dir);
  return dir;
}

/** A folder laid out as the package is, with every file it publishes and one it does not. */
function packageFolder(): string {
  const dir = folder();
  for (const file of ['weeb_3.js', 'weeb_3_bg.wasm', 'service.js', 'worker.js', 'weeb_3.d.ts']) {
    writeFileSync(join(dir, file), file);
  }
  mkdirSync(join(dir, 'snippets', 'weeb_3-0', 'static'), { recursive: true });
  writeFileSync(join(dir, 'snippets', 'weeb_3-0', 'static', 'hls_loader.js'), 'loader');
  return dir;
}

afterEach(() => {
  for (const dir of made.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("the build's copy of weeb-3's files", () => {
  it('places what the browser loads under weeb-3/ in the output, and not the type declarations', () => {
    const out = folder();

    const copied = copyWeeb3Files(packageFolder(), out);

    expect(copied).toBe(true);
    expect(readdirSync(join(out, 'weeb-3')).sort()).toEqual(
      ['service.js', 'snippets', 'weeb_3.js', 'weeb_3_bg.wasm', 'worker.js'].sort(),
    );
    expect(readFileSync(join(out, 'weeb-3', 'snippets', 'weeb_3-0', 'static', 'hls_loader.js'), 'utf8')).toBe('loader');
    expect(WEEB3_FILES).not.toContain('weeb_3.d.ts');
  });

  it("points the package's own default module path at the copy under /weeb-3/, so the bundle carries no second one", () => {
    const code = "if (x === undefined) {\n  module_or_path = new URL('weeb_3_bg.wasm', import.meta.url);\n}";

    expect(withServedWasmPath(code)).toBe(
      "if (x === undefined) {\n  module_or_path = new URL('/weeb-3/weeb_3_bg.wasm', self.location.origin);\n}",
    );
    expect(withServedWasmPath('nothing to rewrite')).toBeNull();
  });

  it('copies nothing when the package is not installed, and answers so', () => {
    const out = folder();

    expect(copyWeeb3Files(null, out)).toBe(false);
    expect(readdirSync(out)).toEqual([]);
  });
});
