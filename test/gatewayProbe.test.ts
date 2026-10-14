import { describe, expect, it } from 'vitest';

import { beeBaseUrlFromTypedAddress, isBlockedAsMixedContent } from '@/features/gateway/gatewayProbe';

describe('beeBaseUrlFromTypedAddress', () => {
  it('strips whitespace and trailing slashes, because every caller appends its own path', () => {
    expect(beeBaseUrlFromTypedAddress('  http://localhost:1633///  ')).toBe('http://localhost:1633');
  });

  it('adds http:// to a bare host and port, which is how an address is copied out of Swarm Desktop', () => {
    expect(beeBaseUrlFromTypedAddress('localhost:1633')).toBe('http://localhost:1633');
    expect(beeBaseUrlFromTypedAddress('192.168.1.20:1633')).toBe('http://192.168.1.20:1633');
  });

  it('leaves an explicit scheme alone, whatever its case', () => {
    expect(beeBaseUrlFromTypedAddress('HTTPS://gateway.example')).toBe('HTTPS://gateway.example');
  });

  it('keeps a path-only address such as the deployed default as it is', () => {
    expect(beeBaseUrlFromTypedAddress('/bee/')).toBe('/bee');
  });

  it('returns an empty string for nothing, so the picker can refuse it', () => {
    expect(beeBaseUrlFromTypedAddress('   ')).toBe('');
  });
});

/**
 * An https page may not load a plain http subresource, and the browser rejects the fetch with the same error a
 * closed port gives, so the checks decide this before asking anything.
 */
describe('a plain http address named from an https page', () => {
  it('is blocked on the internet, whatever the browser', () => {
    expect(isBlockedAsMixedContent('http://192.0.2.10:1633', 'https:', true)).toBe(true);
    expect(isBlockedAsMixedContent('http://192.0.2.10:1633', 'https:', false)).toBe(true);
  });

  it("is not blocked on the viewer's own machine, which browsers exempt", () => {
    expect(isBlockedAsMixedContent('http://localhost:1633', 'https:', false)).toBe(false);
    expect(isBlockedAsMixedContent('http://127.0.0.1:1633', 'https:', false)).toBe(false);
  });

  it('is let through on the local network only by a browser that can mark a request as meant for it', () => {
    expect(isBlockedAsMixedContent('http://192.168.1.20:1633', 'https:', true)).toBe(false);
    expect(isBlockedAsMixedContent('http://192.168.1.20:1633', 'https:', false)).toBe(true);
  });

  it('leaves an https node, a page served over http, and a path on this site alone', () => {
    expect(isBlockedAsMixedContent('https://node.example:1633', 'https:', false)).toBe(false);
    expect(isBlockedAsMixedContent('http://192.168.1.20:1633', 'http:', false)).toBe(false);
    expect(isBlockedAsMixedContent('/bee', 'https:', false)).toBe(false);
  });
});
