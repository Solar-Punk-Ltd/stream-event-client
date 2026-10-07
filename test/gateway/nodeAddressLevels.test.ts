import { describe, expect, it } from 'vitest';

import type { BeeNodeAccess } from '../../src/swarm/beeNodeAccess';
import { ADDRESS_REFUSED } from '../../src/features/gateway/checkSentences';
import { checkOwnNodeAddress } from '../../src/features/gateway/gatewayProbe';

function accepted(input: string, access: BeeNodeAccess): string {
  const result = checkOwnNodeAddress(input, access);
  if (!result.ok) {
    throw new Error(`expected ${input} at ${access} to be accepted, got: ${result.text}`);
  }
  return result.url;
}

function refusal(input: string, access: BeeNodeAccess): string {
  const result = checkOwnNodeAddress(input, access);
  if (result.ok) {
    throw new Error(`expected ${input} at ${access} to be refused, got ${result.url}`);
  }
  return result.text;
}

const LEVELS: readonly BeeNodeAccess[] = ['off', 'https', 'https-and-local-http'];

describe('a node on this computer', () => {
  it.each(LEVELS)('is accepted over plain http at every level, %s included', (access) => {
    expect(accepted('http://localhost:1633', access)).toBe('http://localhost:1633');
    expect(accepted('http://127.0.0.1:1633', access)).toBe('http://127.0.0.1:1633');
  });

  it('is named by one of the three hosts this site allows, even where other machines are allowed', () => {
    expect(refusal('http://127.0.0.2:1633', 'https')).toBe(ADDRESS_REFUSED.otherLoopbackHost);
    expect(refusal('http://my.localhost:1633', 'https-and-local-http')).toBe(ADDRESS_REFUSED.otherLoopbackHost);
  });
});

describe('a node on another machine over https', () => {
  it('is refused when the site allows only this computer, with the hosts it does take', () => {
    expect(refusal('https://bee.example.com', 'off')).toBe(ADDRESS_REFUSED.thisComputerOnly);
    expect(ADDRESS_REFUSED.thisComputerOnly).toContain('localhost or 127.0.0.1');
  });

  it.each(['https', 'https-and-local-http'] as const)('is accepted on any host at %s', (access) => {
    expect(accepted('https://bee.example.com', access)).toBe('https://bee.example.com');
    expect(accepted('https://bee.example.com:8443/', access)).toBe('https://bee.example.com:8443');
    expect(accepted('https://192.168.1.20:1633', access)).toBe('https://192.168.1.20:1633');
  });
});

describe('a node on the local network over plain http', () => {
  const LOCAL = ['http://10.0.0.5:1633', 'http://172.16.4.2:1633', '192.168.1.20:1633', 'http://bee.local:1633'];

  it.each(LOCAL)('%s is accepted only where the site allows local http', (input) => {
    expect(checkOwnNodeAddress(input, 'https-and-local-http').ok).toBe(true);
    expect(refusal(input, 'https')).toBe(ADDRESS_REFUSED.localHttpNotAllowed);
    expect(refusal(input, 'off')).toBe(ADDRESS_REFUSED.thisComputerOnly);
  });

  it('accepts an IPv6 unique local address', () => {
    expect(accepted('http://[fd12:3456::1]:1633', 'https-and-local-http')).toBe('http://[fd12:3456::1]:1633');
  });

  it('says what to type instead when local http is not allowed', () => {
    expect(ADDRESS_REFUSED.localHttpNotAllowed).toContain('https');
    expect(ADDRESS_REFUSED.localHttpNotAllowed).toContain('http://localhost:1633');
  });
});

describe('a node on the internet over plain http', () => {
  it.each(['https', 'https-and-local-http'] as const)('is refused at %s, because a browser blocks it', (access) => {
    expect(refusal('http://bee.example.com:1633', access)).toBe(ADDRESS_REFUSED.plainHttpInternet);
    expect(refusal('http://192.0.2.10:1633', access)).toBe(ADDRESS_REFUSED.plainHttpInternet);
  });

  it('says to type the https address instead', () => {
    expect(ADDRESS_REFUSED.plainHttpInternet).toContain('https://');
  });
});

describe('every refusal of an address', () => {
  it.each(Object.entries(ADDRESS_REFUSED))('%s is plain prose with no dash or semicolon', (_name, sentence) => {
    expect(sentence).not.toMatch(/[—;]/);
  });
});
