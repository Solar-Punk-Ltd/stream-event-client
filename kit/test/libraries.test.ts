import { describe, expect, it } from 'vitest';

import { setId, tarballName } from '../src/libraries.ts';

const CHAT = { repo: 'https://github.com/o/chat.git', commit: 'a'.repeat(40) };
const ID = { repo: 'https://github.com/o/id.git', commit: 'b'.repeat(40), dir: 'lib' };

describe('tarballName', () => {
  it('names the commit a library was packed at', () => {
    expect(tarballName('@solarpunkltd/swarm-chat-js', { kind: 'git', ...CHAT, dir: '.' })).toBe(
      `solarpunkltd-swarm-chat-js-${'a'.repeat(40)}.tgz`,
    );
  });

  it('names the version a published library was fetched at', () => {
    expect(tarballName('@solarpunkltd/swarm-id', { kind: 'npm', version: '0.10.0' })).toBe(
      'solarpunkltd-swarm-id-0.10.0.tgz',
    );
  });
});

describe('setId', () => {
  it('is the same for the same pins in any order', () => {
    expect(setId({ a: CHAT, b: ID })).toBe(setId({ b: ID, a: CHAT }));
  });

  it('changes when one pin moves, so an image built against the old set is not taken for the new one', () => {
    expect(setId({ a: CHAT, b: ID })).not.toBe(setId({ a: { npm: '9.0.0' }, b: ID }));
  });
});
