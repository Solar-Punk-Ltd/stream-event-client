import { PrivateKey } from '@ethersphere/bee-js';
import { MAX_NAME_CHARACTERS } from '@solarpunkltd/swarm-chat-js';
import { describe, expect, it, vi } from 'vitest';

import {
  checkDisplayName,
  ENS_NAME_PROBLEM,
  INVISIBLE_CHARACTERS_PROBLEM,
  nicknameLogin,
} from '../../src/features/chat/auth/login';

const HEX_KEY = /^[0-9a-f]{64}$/;
const HEX_ADDRESS = /^[0-9a-f]{40}$/;

describe('the display name rule', () => {
  it('accepts 1 to 20 characters once the ends are trimmed, and hands back the trimmed name', () => {
    expect(checkDisplayName('  Ada  ')).toEqual({ ok: true, name: 'Ada' });
    expect(checkDisplayName('a')).toEqual({ ok: true, name: 'a' });
    expect(checkDisplayName('b'.repeat(MAX_NAME_CHARACTERS))).toEqual({ ok: true, name: 'b'.repeat(20) });
  });

  it('refuses an empty name, or one of spaces only, and says what is wanted', () => {
    for (const raw of ['', '   ', '\t\n']) {
      const result = checkDisplayName(raw);
      expect(result.ok).toBe(false);
      expect(!result.ok && result.problem).toMatch(/1 to 20 characters/);
    }
  });

  it('refuses a name longer than 20 characters', () => {
    expect(checkDisplayName('c'.repeat(21)).ok).toBe(false);
  });

  it.each([
    ['a right-to-left override', 'evil\u202egnp.exe'],
    ['a zero width space', 'ad\u200bmin'],
    ['a byte order mark', 'Ad\ufeffa'],
    ['a newline inside it', 'Ada\nLovelace'],
    ['a NUL', 'Ada\u0000'],
    ['a left-to-right mark', 'Ad\u200ea'],
    ['a word joiner', 'Ad\u2060a'],
  ])('refuses a name with %s, which draws nothing yet changes how the name reads', (_what, raw) => {
    expect(checkDisplayName(raw)).toEqual({ ok: false, problem: INVISIBLE_CHARACTERS_PROBLEM });
  });

  it.each([
    ['alice.eth'],
    ['Alice.ETH'],
    ['  alice.eth  '],
    ['\uff36\uff29\uff34\uff21\uff2c\uff29\uff2b\uff0e\uff25\uff34\uff28'],
    ['alice\u3002eth'],
  ])('refuses %s, since a name ending in .eth could pass for a verified ENS name', (raw) => {
    expect(checkDisplayName(raw)).toEqual({ ok: false, problem: ENS_NAME_PROBLEM });
  });

  it('says plainly why a name ending in .eth is refused', () => {
    expect(ENS_NAME_PROBLEM).toBe('Names ending in .eth are kept for ENS names.');
  });

  it('accepts a name that only mentions eth', () => {
    expect(checkDisplayName('eth fan').ok).toBe(true);
    expect(checkDisplayName('alice.ethereum').ok).toBe(true);
  });

  it('accepts names in any script', () => {
    for (const name of ['Zoë', 'Алиса', '李雷', 'سارا', 'नमस्ते']) {
      expect(checkDisplayName(name)).toEqual({ ok: true, name });
    }
  });

  it.each([
    ['a family emoji joined by zero width joiners', '\u{1F468}\u200d\u{1F469}\u200d\u{1F467}'],
    ['a Persian name with a zero width non-joiner', 'می\u200cخواهم'],
    ['a Devanagari conjunct with a zero width joiner', 'क्\u200dष'],
  ])('accepts %s, since the joiners shape the name rather than hide anything', (_what, name) => {
    expect(checkDisplayName(name)).toEqual({ ok: true, name });
  });

  it('counts an emoji as one character, not as the two code units it takes', () => {
    expect(checkDisplayName('🙂'.repeat(20)).ok).toBe(true);
    expect(checkDisplayName('🙂'.repeat(21)).ok).toBe(false);
  });
});

describe('logging in with a display name', () => {
  it('makes the key from 32 random bytes of the browser crypto', () => {
    const spy = vi.spyOn(globalThis.crypto, 'getRandomValues');
    nicknameLogin('Ada');
    expect(spy).toHaveBeenCalledTimes(1);
    expect((spy.mock.calls[0][0] as Uint8Array).length).toBe(32);
    spy.mockRestore();
  });

  it('gives a 64 digit hex key and the 40 digit address that key signs as', () => {
    const session = nicknameLogin('Ada');
    expect(session.privateKey).toMatch(HEX_KEY);
    expect(session.address).toMatch(HEX_ADDRESS);
    expect(session.address).toBe(new PrivateKey(session.privateKey).publicKey().address().toHex());
  });

  it('uses the random bytes as the key, unchanged', () => {
    const bytes = Uint8Array.from({ length: 32 }, (_, i) => i + 1);
    const session = nicknameLogin('Ada', () => bytes);
    expect(session.privateKey).toBe(Buffer.from(bytes).toString('hex'));
  });

  it('gives every login its own key', () => {
    const keys = new Set(Array.from({ length: 20 }, () => nicknameLogin('Ada').privateKey));
    expect(keys.size).toBe(20);
  });

  it('keeps the trimmed name', () => {
    expect(nicknameLogin('  Ada ').username).toBe('Ada');
  });

  it('refuses a name the rule refuses, without making a key', () => {
    const randomBytes = vi.fn(() => new Uint8Array(32).fill(1));
    expect(() => nicknameLogin('   ', randomBytes)).toThrow(/1 to 20 characters/);
    expect(randomBytes).not.toHaveBeenCalled();
  });
});
