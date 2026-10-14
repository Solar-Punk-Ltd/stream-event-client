import { describe, expect, it } from 'vitest';

import type { CheckResult } from '../../src/features/gateway/providerTest';
import { addressHint, fixGroups, testStatusLine, unavailableTypeReason } from '../../src/features/gateway/sourceWords';

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

describe('the fixes behind How to fix', () => {
  const failure = (check: CheckResult['check'], sentence: string, intro?: string): CheckResult => ({
    check,
    outcome: 'failed',
    sentence,
    ...(intro === undefined ? {} : { help: { intro, steps: [], note: 'note' } }),
  });

  it('shows a fix several failed checks share once, headed by the parts it applies to', () => {
    const groups = fixGroups([
      failure('connection', 'Could not reach it.', 'Allow this site'),
      failure('stream-list', 'Could not reach it.', 'Allow this site'),
      failure('thumbnails', 'The pictures failed.'),
    ]);

    expect(groups.map(({ heading, sentence }) => [heading, sentence])).toEqual([
      ['Connection and stream list', 'Could not reach it.'],
      ['Pictures', 'The pictures failed.'],
    ]);
    expect(groups[0].help?.intro).toBe('Allow this site');
  });

  it('keeps two checks apart when their sentences match and their steps do not', () => {
    const groups = fixGroups([failure('connection', 'Same.', 'One fix'), failure('chat', 'Same.', 'Another fix')]);

    expect(groups.map(({ heading }) => heading)).toEqual(['Connection', 'Chat']);
  });

  it('leaves out every check that did not fail', () => {
    expect(fixGroups([result('connection', 'passed'), result('chat', 'skipped')])).toEqual([]);
  });
});

describe('the hint under an address', () => {
  it('says where a Bee node may be, and that a gateway is an https address', () => {
    expect(addressHint('bee-node')).toBe('On this computer or at an https address');
    expect(addressHint('gateway')).toBe('An https address');
  });
});

describe('a type of source a viewer cannot add', () => {
  it('is none on any deployment, since the page decides the kinds it offers', () => {
    for (const type of ['gateway', 'bee-node', 'weeb-3'] as const) {
      expect(unavailableTypeReason(type)).toBeNull();
    }
  });
});

describe('the node in this browser', () => {
  it('is offered once, since a browser runs one', () => {
    expect(unavailableTypeReason('weeb-3', ['weeb-3'])).toBe('Already added');
  });

  it('says where it is without an address', () => {
    expect(addressHint('weeb-3')).toBe('Runs in this tab, no address needed');
  });
});
