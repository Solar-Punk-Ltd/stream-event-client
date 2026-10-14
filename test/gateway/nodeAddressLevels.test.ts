import { describe, expect, it } from 'vitest';

import { ADDRESS_REFUSED } from '../../src/features/gateway/checkSentences';
import { checkOwnNodeAddress, checkSourceAddress } from '../../src/features/gateway/gatewayProbe';

function accepted(input: string): string {
  const result = checkOwnNodeAddress(input);
  if (!result.ok) {
    throw new Error(`expected ${input} to be accepted, got: ${result.text}`);
  }
  return result.url;
}

function refusal(input: string): string {
  const result = checkOwnNodeAddress(input);
  if (result.ok) {
    throw new Error(`expected ${input} to be refused, got ${result.url}`);
  }
  return result.text;
}

describe('a node on this computer', () => {
  it('is accepted over plain http and https', () => {
    expect(accepted('http://localhost:1633')).toBe('http://localhost:1633');
    expect(accepted('http://127.0.0.1:1633')).toBe('http://127.0.0.1:1633');
    expect(accepted('https://localhost:1635')).toBe('https://localhost:1635');
  });

  it('is named by one of the two hosts the page allows', () => {
    expect(refusal('http://127.0.0.2:1633')).toBe(ADDRESS_REFUSED.otherLoopbackHost);
    expect(refusal('http://my.localhost:1633')).toBe(ADDRESS_REFUSED.otherLoopbackHost);
  });

  it('cannot be named [::1], which no policy can allow on its own', () => {
    expect(refusal('http://[::1]:1633')).toBe(ADDRESS_REFUSED.ipv6Loopback);
  });
});

describe('a node on another machine', () => {
  it('is accepted at any https address, whatever the deployment', () => {
    expect(accepted('https://bee.example.com')).toBe('https://bee.example.com');
    expect(accepted('https://bee.example.com:8443/')).toBe('https://bee.example.com:8443');
    expect(accepted('https://192.168.1.20:1633')).toBe('https://192.168.1.20:1633');
  });

  it.each(['http://10.0.0.5:1633', '192.168.1.20:1633', 'http://bee.local:1633', 'http://192.0.2.10:1633'])(
    'is refused over plain http at %s, with what to type instead',
    (input) => {
      expect(refusal(input)).toBe(ADDRESS_REFUSED.plainHttp);
    },
  );

  it('says to type the https address instead', () => {
    expect(ADDRESS_REFUSED.plainHttp).toContain('https://');
    expect(ADDRESS_REFUSED.plainHttp).toContain('http://localhost:1633');
  });
});

describe('every refusal of an address', () => {
  it.each(Object.entries(ADDRESS_REFUSED))('%s is plain prose with no dash or semicolon', (_name, sentence) => {
    expect(sentence).not.toMatch(/[—;]/);
  });
});

describe('the address of a gateway the viewer adds', () => {
  it('is taken as https when typed without a scheme', () => {
    expect(checkSourceAddress('gateway', 'gw.example.com')).toEqual({ ok: true, url: 'https://gw.example.com' });
  });

  it('holds to the same rules as a Bee node', () => {
    expect(checkSourceAddress('gateway', 'http://gw.example.com')).toEqual({
      ok: false,
      text: ADDRESS_REFUSED.plainHttp,
    });
  });

  it('leaves a Bee node typed without a scheme on http, as the picker always has', () => {
    expect(checkSourceAddress('bee-node', 'localhost:1633')).toEqual({ ok: true, url: 'http://localhost:1633' });
  });
});
