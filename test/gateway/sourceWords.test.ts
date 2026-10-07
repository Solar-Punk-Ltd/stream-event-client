import { describe, expect, it } from 'vitest';

import type { CheckResult } from '../../src/features/gateway/providerTest';
import { addressHint, testStatusLine, unavailableTypeReason } from '../../src/features/gateway/sourceWords';

const result = (check: CheckResult['check'], outcome: CheckResult['outcome']): CheckResult => ({
  check,
  outcome,
  sentence: 'whatever',
});

describe("a tested source's one status line", () => {
  it('says everything tested works when nothing failed, whatever was not applicable', () => {
    expect(testStatusLine([result('connection', 'passed'), result('chat', 'skipped')])).toBe('Everything tested works');
  });

  it('names what failed, in the order the checks run', () => {
    expect(testStatusLine([result('connection', 'passed'), result('player', 'failed')])).toBe('Video failed');
    expect(
      testStatusLine([result('stream-list', 'failed'), result('player', 'failed'), result('thumbnails', 'failed')]),
    ).toBe('Stream list, video and pictures failed');
  });
});

describe('the hint under an address', () => {
  it("says where a Bee node may be at each of the deployment's levels", () => {
    expect(addressHint('bee-node', 'off')).toBe('On this computer, such as Swarm Desktop');
    expect(addressHint('bee-node', 'https')).toContain('another machine');
    expect(addressHint('bee-node', 'https-and-local-http')).toContain('Chrome or Edge');
  });

  it('says a gateway is an https address', () => {
    expect(addressHint('gateway', 'https')).toBe('An https address');
  });
});

describe('a type of source a viewer cannot add here', () => {
  it('is a gateway on a site that allows only its own, or any type whose kind the deployment does not offer', () => {
    expect(unavailableTypeReason('gateway', 'off', ['bee-http'])).toBe('Not allowed on this site');
    expect(unavailableTypeReason('gateway', 'https', ['bee-http'])).toBeNull();
    expect(unavailableTypeReason('bee-node', 'off', ['bee-http'])).toBeNull();
    expect(unavailableTypeReason('bee-node', 'off', [])).toBe('Not offered on this site');
  });
});
