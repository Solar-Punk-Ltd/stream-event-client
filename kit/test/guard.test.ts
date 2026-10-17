import { describe, expect, it } from 'vitest';

import { LOCAL_GUARD, liveGuard, resolverRules } from '../src/guard.ts';

const live = liveGuard([
  'https://viewer.example.com',
  'https://viewer.example.com/bee',
  'https://gateway.example.com/chat',
  'https://id.example.com',
  'https://ethereum-rpc.example.org',
  'http://[::1]:4998',
]);

describe('the local guard', () => {
  it('lets through what stays on this machine and resolves no outside name', () => {
    expect(LOCAL_GUARD.allows('http://127.0.0.1:4180/')).toBe(true);
    expect(LOCAL_GUARD.allows('https://viewer.example.com/')).toBe(false);
    expect(LOCAL_GUARD.hosts).toEqual([]);
  });
});

describe('liveGuard', () => {
  it('lets through exactly the origins the target and config name, and what the browser answers itself', () => {
    for (const url of [
      'https://viewer.example.com/config.json',
      'https://gateway.example.com/chat/soc/ab/cd',
      'https://gateway.example.com/feeds/ab/cd',
      'https://id.example.com/proxy',
      'https://ethereum-rpc.example.org/',
      'http://[::1]:4998/?swarmId=x',
      'data:text/plain,hi',
      'blob:https://viewer.example.com/1',
    ]) {
      expect(live.allows(url), url).toBe(true);
    }
  });

  it('stops every other origin, a local one, a look-alike and another port included', () => {
    for (const url of [
      'https://example.com/',
      'http://localhost:1633/health',
      'http://127.0.0.1:4180/',
      'https://viewer.example.com.evil.example.net/',
      'https://viewer.example.com:8443/',
      'http://viewer.example.com/',
      'https://rsms.me/inter/inter.css',
      'not a url',
    ]) {
      expect(live.allows(url), url).toBe(false);
    }
  });

  it('lets the browser resolve the named outside hosts only, once each', () => {
    expect(live.hosts).toEqual([
      'viewer.example.com',
      'gateway.example.com',
      'id.example.com',
      'ethereum-rpc.example.org',
    ]);
  });
});

describe('resolverRules', () => {
  it('maps every name to nothing but the local ones and the hosts given', () => {
    expect(resolverRules([])).toBe(
      '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE localhost, EXCLUDE *.localhost, EXCLUDE 127.0.0.1, EXCLUDE ::1',
    );
    expect(resolverRules(['id.example.com'])).toBe(
      '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE localhost, EXCLUDE *.localhost, EXCLUDE 127.0.0.1, EXCLUDE ::1, EXCLUDE id.example.com',
    );
  });
});
