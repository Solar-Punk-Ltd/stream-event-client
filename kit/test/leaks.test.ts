import { describe, expect, it } from 'vitest';

import { findLeaks, searchProblems } from '../src/leaks.ts';

const KEY = 'ab'.repeat(32);

describe('findLeaks', () => {
  it('finds a secret in hex, with or without 0x, in any case, and in base64', () => {
    const base64 = Buffer.from(KEY, 'hex').toString('base64');
    expect(findLeaks({ 'a.har': `x${KEY.toUpperCase()}y` }, { stampKey: KEY })).toEqual(['stampKey in a.har']);
    expect(findLeaks({ dom: `0x${KEY}` }, { stampKey: KEY })).toEqual(['stampKey in dom']);
    expect(findLeaks({ storage: `"${base64}"` }, { stampKey: KEY })).toEqual(['stampKey in storage']);
  });

  it('reports nothing where the secret is absent, and never the secret itself', () => {
    expect(findLeaks({ 'a.har': 'nothing here', dom: 'cd'.repeat(32) }, { stampKey: KEY })).toEqual([]);
  });

  it('refuses an empty secret, which every text would contain', () => {
    expect(() => findLeaks({ dom: 'x' }, { stampKey: '' })).toThrow(/empty/);
    expect(() => findLeaks({ dom: 'x' }, { password: '' })).toThrow(/empty/);
  });

  it('finds a secret that is text, such as a phrase or a password, as typed, encoded in an address, and in base64', () => {
    const phrase = 'abandon ability able about';
    const password = 'p&ss/w+rd "x"';
    expect(findLeaks({ trace: `value:"${phrase}"` }, { phrase })).toEqual(['phrase in trace']);
    expect(findLeaks({ har: `?q=${encodeURIComponent(phrase)}` }, { phrase })).toEqual(['phrase in har']);
    expect(findLeaks({ har: `q=${phrase.replaceAll(' ', '+')}` }, { phrase })).toEqual(['phrase in har']);
    expect(findLeaks({ har: Buffer.from(phrase).toString('base64') }, { phrase })).toEqual(['phrase in har']);
    expect(findLeaks({ har: JSON.stringify({ typed: password }) }, { password })).toEqual(['password in har']);
  });

  it('never reads a text secret as hex, so a few hex letters at its start are not decoded into bytes found elsewhere', () => {
    expect(findLeaks({ har: 'qw==' }, { password: 'abzz-zzzz' })).toEqual([]);
    expect(findLeaks({ har: 'nothing typed here' }, { phrase: 'abandon ability able about' })).toEqual([]);
  });
});

describe('searchProblems', () => {
  const BATCH = 'cd'.repeat(32);

  it('passes when the recorded network holds the public batch id and a trace holds text', () => {
    expect(searchProblems(`{"x":"${BATCH}"}`, { 'trace-01.zip/trace.trace': '{"type":"before"}' }, BATCH)).toEqual([]);
  });

  it('refuses a network without the batch id, even when a trace holds it, and a run with no text in any trace', () => {
    expect(searchProblems('{}', { 'trace-01.zip/trace.trace': BATCH }, BATCH)).toEqual([
      'the recorded network does not hold the drive’s batch id, so its silence about keys proves nothing',
    ]);
    expect(searchProblems(BATCH, { 'trace-01.zip/trace.trace': '' }, BATCH)).toEqual([
      'no trace holds any text, so the traces were not searched',
    ]);
    expect(searchProblems(BATCH, {}, BATCH)).toEqual(['no trace holds any text, so the traces were not searched']);
  });
});
