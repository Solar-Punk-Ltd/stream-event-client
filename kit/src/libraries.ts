import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';

import { type KitLock, librarySource, type LibrarySource } from './lock.ts';
import { KIT_DIR, REPO_DIR } from './paths.ts';

/** Every tarball ever packed, by name and pin, kept across `kit down --fresh` since a pin's tarball never changes. */
const CACHE_DIR = join(REPO_DIR, 'node_modules', '.flow-kit', 'libraries');
/** The packed set of the current lock, the build context the images install from. */
export const LIBRARY_SET_DIR = join(CACHE_DIR, 'current');
/** Where the kit's own process gets the same libraries, installed beside the repository's own tree. */
const HOST_DIR = join(REPO_DIR, 'node_modules', '.flow-kit', 'host');
const INSTALLER = join(KIT_DIR, 'images', 'library', 'install.mjs');

/** What the images read from the packed set: each library's tarball and where it came from. */
interface LibraryManifest {
  /** One id for the whole set, so an image built against another set is never taken for this one. */
  id: string;
  libraries: Record<string, { file: string; source: LibrarySource }>;
}

function run(command: string, args: string[], cwd = REPO_DIR): void {
  const result = spawnSync(command, args, { cwd, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(
      `${command} ${args.join(' ')} exited ${result.status}\n--- stdout\n${result.stdout}\n--- stderr\n${result.stderr}`,
    );
  }
}

/** The tarball's file name for one pin, which names the pin so a stale tarball can never stand in for it. */
export function tarballName(name: string, source: LibrarySource): string {
  const base = name.replace(/^@/, '').replace('/', '-');
  return source.kind === 'npm' ? `${base}-${source.version}.tgz` : `${base}-${source.commit}.tgz`;
}

/** The id of a set of pins, the same for the same lock entries in any order. */
export function setId(libraries: KitLock['libraries']): string {
  const entries = Object.keys(libraries)
    .sort()
    .map((name) => [name, libraries[name]]);
  return createHash('sha256').update(JSON.stringify(entries)).digest('hex').slice(0, 12);
}

/** One library's tarball, packed from its repository in a container or fetched from the registry, into the cache. */
function pack(name: string, source: LibrarySource): string {
  const file = join(CACHE_DIR, tarballName(name, source));
  if (existsSync(file)) return file;
  mkdirSync(CACHE_DIR, { recursive: true });
  const out = mkdtempSync(join(tmpdir(), 'flow-kit-library-'));
  try {
    if (source.kind === 'npm') {
      run('npm', ['pack', `${name}@${source.version}`, '--pack-destination', out, '--silent']);
    } else {
      console.log(`kit: packing ${name} at ${source.commit.slice(0, 9)}`);
      run('docker', [
        'build',
        '--build-arg',
        `LIBRARY_REPO=${source.repo}`,
        '--build-arg',
        `LIBRARY_COMMIT=${source.commit}`,
        '--build-arg',
        `LIBRARY_DIR=${source.dir}`,
        '--output',
        `type=local,dest=${out}`,
        join(KIT_DIR, 'images', 'library'),
      ]);
    }
    const packed = readdirSync(out).filter((entry) => entry.endsWith('.tgz'));
    if (packed.length !== 1) throw new Error(`packing ${name} left ${packed.length} tarballs, not one`);
    renameSync(join(out, packed[0]), file);
    return file;
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
}

/**
 * Packs every library the lock pins, writes them with their manifest and the installer as the build context the
 * viewer and chat server images install them from, and returns the manifest.
 */
function packLibraries(lock: KitLock): LibraryManifest & { dir: string } {
  const manifest: LibraryManifest = { id: setId(lock.libraries), libraries: {} };
  rmSync(LIBRARY_SET_DIR, { recursive: true, force: true });
  mkdirSync(LIBRARY_SET_DIR, { recursive: true });
  for (const [name, pin] of Object.entries(lock.libraries)) {
    const source = librarySource(pin);
    const file = tarballName(name, source);
    copyFileSync(pack(name, source), join(LIBRARY_SET_DIR, file));
    manifest.libraries[name] = { file, source };
  }
  copyFileSync(INSTALLER, join(LIBRARY_SET_DIR, 'install.mjs'));
  writeFileSync(join(LIBRARY_SET_DIR, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  return { ...manifest, dir: LIBRARY_SET_DIR };
}

/** The version a package folder says it is, or null when there is none. */
function installedVersion(dir: string): string | null {
  try {
    return (JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) as { version?: string }).version ?? null;
  } catch {
    return null;
  }
}

/** The pnpm settings of the repository that keep young versions out, copied so the kit's own install keeps them too. */
function ageSettings(): string {
  const workspace = readFileSync(join(REPO_DIR, 'pnpm-workspace.yaml'), 'utf8');
  const keep = workspace
    .split('\n')
    .filter((line) => /^(minimumReleaseAge|minimumReleaseAgeStrict|saveExact):/.test(line));
  return `${keep.join('\n')}\n`;
}

/**
 * Installs the packed libraries for the kit's own process, which reads the chat feed with the same chat library the
 * stack runs, and points the repository's `node_modules/<name>` at them. The repository's own `package.json` and
 * lockfile stay as committed, and a plain `pnpm install` puts the published versions back.
 */
function linkLibraries(set: LibraryManifest & { dir: string }): void {
  const stampFile = join(HOST_DIR, 'set-id');
  const current = existsSync(stampFile) ? readFileSync(stampFile, 'utf8').trim() : null;
  const linked = Object.keys(set.libraries).every((name) => {
    const link = join(REPO_DIR, 'node_modules', name);
    return existsSync(link) && lstatSync(link).isSymbolicLink() && readlinkSync(link).includes('.flow-kit');
  });
  if (current === set.id && linked) return;

  rmSync(HOST_DIR, { recursive: true, force: true });
  mkdirSync(HOST_DIR, { recursive: true });
  const dependencies: Record<string, string> = {};
  for (const [name, { file }] of Object.entries(set.libraries)) dependencies[name] = `file:${join(set.dir, file)}`;
  // Linked rather than installed again, so the libraries see the one bee-js the repository and its types use.
  dependencies['@ethersphere/bee-js'] = `link:${join(REPO_DIR, 'node_modules', '@ethersphere', 'bee-js')}`;
  writeFileSync(join(HOST_DIR, 'package.json'), JSON.stringify({ private: true, dependencies }, null, 2));
  writeFileSync(join(HOST_DIR, 'pnpm-workspace.yaml'), ageSettings());
  console.log('kit: installing the packed libraries for the kit itself');
  run('pnpm', ['install', '--ignore-scripts', '--config.auto-install-peers=false'], HOST_DIR);

  for (const name of Object.keys(set.libraries)) {
    const link = join(REPO_DIR, 'node_modules', name);
    const target = join(HOST_DIR, 'node_modules', name);
    rmSync(link, { recursive: true, force: true });
    mkdirSync(dirname(link), { recursive: true });
    symlinkSync(relative(dirname(link), target), link);
    console.log(`kit: ${name} ${installedVersion(target)} linked for the kit`);
  }
  writeFileSync(stampFile, `${set.id}\n`);
}

/** Packs the pinned libraries and links them for the kit, `kit libraries` on its own and the first step of `kit up`. */
export function prepareLibraries(lock: KitLock): LibraryManifest & { dir: string } {
  const set = packLibraries(lock);
  linkLibraries(set);
  return set;
}
