/**
 * A preview card must not spin forever when its manifest produces no segments, which includes the
 * case where the gateway answers 404: the status has to be read, because a 404 body parsed as a
 * manifest gives an empty result, and every exit has to clear the loading flag. Failure and "still
 * working on it" must not be the same pixels.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'vitest';

import { previewSourceFrom } from '../src/features/catalog/StreamPreview/previewSource';

const OK = { ok: true, status: 200 };

describe('what a preview card should do with the manifest it fetched', () => {
  it('plays the first segment when the manifest lists one', () => {
    const source = previewSourceFrom(OK, [
      { extinf: '#EXTINF:2.0,', uri: 'seg0.ts' },
      { extinf: '#EXTINF:2.0,', uri: 'seg1.ts' },
    ]);

    assert.equal(source.kind === 'playable' ? source.firstSegment.uri : null, 'seg0.ts');
  });

  it('reports a manifest that lists no segments as unavailable rather than pending', () => {
    const source = previewSourceFrom(OK, []);

    assert.equal(source.kind, 'unavailable', 'an empty playlist left the card loading for good');
  });

  // The two cases below are one value by the time the parser has finished with them: a 404 page and an
  // empty playlist both parse to `segments: []`. Keeping them apart is the whole point of reading `ok`.
  it('reports a gateway that refused the manifest as unavailable, and names the status', () => {
    const source = previewSourceFrom({ ok: false, status: 404 }, []);

    assert.equal(source.kind, 'unavailable');
    assert.match(
      source.kind === 'unavailable' ? source.reason : '',
      /404/,
      'the reason must name the refusal, not describe an empty broadcast',
    );
  });

  it('does not call a refusal empty even when the error body happens to parse into segments', () => {
    const source = previewSourceFrom({ ok: false, status: 500 }, [{ extinf: '#EXTINF:2.0,', uri: 'seg0.ts' }]);

    assert.equal(source.kind, 'unavailable', 'a 500 body is not a playlist however well it parses');
  });

  /**
   * A gap entry stands in for a sequence the broadcast lost, so its URI names nothing a gateway can
   * serve. A card built on one would ask for a reference that does not exist and spin until it gave up.
   */
  it('takes the first real segment rather than a gap entry', () => {
    const source = previewSourceFrom(OK, [
      { extinf: '#EXTINF:2.0,', uri: 'gap-0', gap: true },
      { extinf: '#EXTINF:2.0,', uri: 'seg1.ts' },
    ]);

    assert.equal(source.kind, 'playable');
    assert.equal(source.kind === 'playable' ? source.firstSegment.uri : '', 'seg1.ts');
  });

  it('reports a manifest of nothing but gap entries as unavailable', () => {
    const source = previewSourceFrom(OK, [{ extinf: '#EXTINF:2.0,', uri: 'gap-0', gap: true }]);

    assert.equal(source.kind, 'unavailable', 'a card cannot be built from media the broadcast lost');
  });
});
