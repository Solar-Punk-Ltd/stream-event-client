import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { librarySource, parseLock } from '../src/lock.ts';

const PINS = {
  bee: '2.8.3',
  foundry: 'v1.5.1',
  swarmId: { repo: 'https://github.com/o/r.git', commit: 'b'.repeat(40) },
  chatServer: { repo: 'https://github.com/o/s.git', commit: 'a'.repeat(40) },
  libraries: {},
};

describe('parseLock', () => {
  it('reads the kit lock file as committed', () => {
    const lock = parseLock(JSON.parse(readFileSync(join(import.meta.dirname, '..', 'kit.lock.json'), 'utf8')));
    expect(lock.bee).toBe('2.8.3');
    expect(lock.swarmId.commit).toMatch(/^[0-9a-f]{40}$/);
  });

  it('builds the Swarm ID app at the commit its library is packed from, while both come from the repository', () => {
    const lock = parseLock(JSON.parse(readFileSync(join(import.meta.dirname, '..', 'kit.lock.json'), 'utf8')));
    const library = librarySource(lock.libraries['@solarpunkltd/swarm-id']);
    expect(library.kind === 'npm' || library.commit === lock.swarmId.commit).toBe(true);
  });

  it('refuses a branch name where a commit belongs', () => {
    expect(() => parseLock({ ...PINS, swarmId: { repo: 'https://github.com/o/r.git', commit: 'main' } })).toThrow();
  });

  it('takes a library at a commit, in a folder of its repository', () => {
    const lock = parseLock({
      ...PINS,
      libraries: {
        '@solarpunkltd/swarm-id': { repo: 'https://github.com/o/id.git', commit: 'c'.repeat(40), dir: 'lib' },
      },
    });
    expect(librarySource(lock.libraries['@solarpunkltd/swarm-id'])).toEqual({
      kind: 'git',
      repo: 'https://github.com/o/id.git',
      commit: 'c'.repeat(40),
      dir: 'lib',
    });
  });

  it('takes a library at a published version, once the lock switches to npm', () => {
    const lock = parseLock({ ...PINS, libraries: { '@solarpunkltd/swarm-chat-js': { npm: '9.0.0' } } });
    expect(librarySource(lock.libraries['@solarpunkltd/swarm-chat-js'])).toEqual({ kind: 'npm', version: '9.0.0' });
  });

  it('refuses a library pinned by a range or a branch, which could move under the kit', () => {
    expect(() => parseLock({ ...PINS, libraries: { '@o/lib': { npm: '^9.0.0' } } })).toThrow();
    expect(() =>
      parseLock({ ...PINS, libraries: { '@o/lib': { repo: 'https://github.com/o/l.git', commit: 'feat/x' } } }),
    ).toThrow();
  });

  it('refuses a library folder that climbs out of its repository', () => {
    expect(() =>
      parseLock({
        ...PINS,
        libraries: { '@o/lib': { repo: 'https://github.com/o/l.git', commit: 'c'.repeat(40), dir: '../x' } },
      }),
    ).toThrow();
  });
});
