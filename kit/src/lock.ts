import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { z } from 'zod';

import { KIT_DIR } from './paths.ts';

const commit = z.string().regex(/^[0-9a-f]{40}$/, 'a whole commit id, so a moved branch cannot change what runs');

const pinnedSource = z.strictObject({
  repo: z.url({ protocol: /^https$/ }),
  commit,
});

/**
 * A library the viewer and the chat server are built against, installed over the version their own lockfiles name.
 * Before a release is published it is built from its repository at a commit, `dir` naming the package's folder in a
 * repository that holds several. After the publish the same entry names the published version, so the kit runs
 * exactly what users install.
 */
const library = z.union([
  z.strictObject({
    repo: z.url({ protocol: /^https$/ }),
    commit,
    dir: z
      .string()
      .regex(/^[a-z0-9-]+(\/[a-z0-9-]+)*$/, 'a folder inside the repository')
      .optional(),
  }),
  z.strictObject({ npm: z.string().regex(/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/, 'one exact version') }),
]);

const lockSchema = z.strictObject({
  bee: z.string().regex(/^\d+\.\d+\.\d+$/),
  foundry: z.string().regex(/^v\d+\.\d+\.\d+$/),
  swarmId: pinnedSource,
  chatServer: pinnedSource,
  libraries: z.record(z.string().regex(/^@[a-z0-9-]+\/[a-z0-9-]+$/, 'a scoped package name'), library),
});

/** The versions and commits every other part of the stack is pinned at, from `kit/kit.lock.json`. */
export type KitLock = z.infer<typeof lockSchema>;
type LibraryPin = z.infer<typeof library>;

/** Where one library comes from, the two shapes of its lock entry told apart. */
export type LibrarySource =
  | { kind: 'git'; repo: string; commit: string; dir: string }
  | { kind: 'npm'; version: string };

export function librarySource(pin: LibraryPin): LibrarySource {
  return 'npm' in pin
    ? { kind: 'npm', version: pin.npm }
    : { kind: 'git', repo: pin.repo, commit: pin.commit, dir: pin.dir ?? '.' };
}

export function parseLock(value: unknown): KitLock {
  return lockSchema.parse(value);
}

export function readLock(): KitLock {
  return parseLock(JSON.parse(readFileSync(join(KIT_DIR, 'kit.lock.json'), 'utf8')));
}
