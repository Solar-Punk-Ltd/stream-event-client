import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import {
  copyWeeb3Files,
  wasmBytesOf,
  WEEB3_FILES,
  WEEB3_HLS_MODULE,
  weeb3HlsRedirect,
  weeb3VersionOf,
  withServedWasmPath,
} from '../scripts/weeb3-files.mjs';

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

  it("records the module's own size for the page, the length it counts its download against", () => {
    expect(wasmBytesOf(packageFolder())).toBe('weeb_3_bg.wasm'.length);
    expect(wasmBytesOf(null)).toBeNull();
  });

  it("records the package's version for the page, which a source's settings name", () => {
    const dir = packageFolder();
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: '@lat-murmeldjur/weeb_3', version: '0.0.354001' }));

    expect(weeb3VersionOf(dir)).toBe('0.0.354001');
    expect(weeb3VersionOf(packageFolder())).toBeNull();
    expect(weeb3VersionOf(null)).toBeNull();
  });

  it("points weeb-3's own import of hls.js at the app's stoppable one, and no other import", () => {
    const dir = packageFolder();
    const loader = join(dir, 'snippets', 'weeb_3-0', 'static', 'hls_loader.js');
    const target = join('/repo', WEEB3_HLS_MODULE);

    expect(weeb3HlsRedirect('hls.js', loader, dir, '/repo')).toBe(target);
    expect(weeb3HlsRedirect('hls.js', `${loader}?v=1`, dir, '/repo')).toBe(target);
    expect(weeb3HlsRedirect('hls.js', '/repo/src/features/player/hlsPlayer.ts', dir, '/repo')).toBeNull();
    expect(weeb3HlsRedirect('hls.js', `${dir}-other/index.js`, dir, '/repo')).toBeNull();
    expect(weeb3HlsRedirect('./other.js', loader, dir, '/repo')).toBeNull();
    expect(weeb3HlsRedirect('hls.js', undefined, dir, '/repo')).toBeNull();
    expect(weeb3HlsRedirect('hls.js', loader, null, '/repo')).toBeNull();
  });

  it('copies nothing when the package is not installed, and answers so', () => {
    const out = folder();

    expect(copyWeeb3Files(null, out)).toBe(false);
    expect(readdirSync(out)).toEqual([]);
  });
});
