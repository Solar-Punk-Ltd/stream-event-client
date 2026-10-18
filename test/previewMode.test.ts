/**
 * Every preview card used to take its frame by fetching the stream's manifest feed and decoding the
 * first segment it found. A scheduled entry has no manifest feed: the topic is an announcement, and
 * nothing is written under it until the broadcast starts, so that fetch was a guaranteed miss that
 * cost a slot on a queue of concurrency 1, and on the deployed build left the card spinning for good.
 * The image the broadcaster had uploaded went unread either way.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'vitest';

import { pictureFailed, pictureSourceOf, previewMode } from '../src/features/catalog/StreamPreview/previewMode';

const REF = '6ce8aab7f729e4614ceab32b108336e0d25d53a673bc7c028d01ff386a9aaa70';

describe('where a preview card gets its picture', () => {
  it('renders the uploaded image when the entry carries one, whatever the stream is doing', () => {
    assert.equal(previewMode({ thumbnail: REF, state: 'live' }), 'image');
    assert.equal(previewMode({ thumbnail: REF, state: 'vod' }), 'image');
    assert.equal(previewMode({ thumbnail: REF, state: 'scheduled' }), 'image');
  });

  it('probes the manifest for a live or finished stream with no image', () => {
    assert.equal(previewMode({ state: 'live' }), 'probe');
    assert.equal(previewMode({ state: 'vod' }), 'probe');
  });

  /**
   * An entry published by the uploader carries no `state` at all in some shapes, and a catalog is
   * parsed unchecked, so "no status" has to mean the behaviour that was already correct.
   */
  it('probes an entry with no status, which is every entry the uploader wrote', () => {
    assert.equal(previewMode({}), 'probe');
  });

  it('treats an empty or blank thumbnail as no thumbnail rather than as a reference', () => {
    assert.equal(previewMode({ thumbnail: '', state: 'live' }), 'probe');
    assert.equal(previewMode({ thumbnail: '   ', state: 'live' }), 'probe');
  });

  // ⛔ The rule the whole module exists for. There is no manifest behind a scheduled topic, so a probe
  // there can only end as a wasted queue slot and a placeholder, before the fetch or after it.
  it('never probes a scheduled stream that has no image', () => {
    assert.equal(previewMode({ state: 'scheduled' }), 'placeholder');
  });

  it('falls back to the placeholder, not the probe, when a scheduled stream’s image fails to load', () => {
    assert.equal(previewMode({ thumbnail: REF, state: 'scheduled', imageFailed: true }), 'placeholder');
  });

  it('falls back to the probe when a live or finished stream’s image fails to load', () => {
    assert.equal(previewMode({ thumbnail: REF, state: 'live', imageFailed: true }), 'probe');
    assert.equal(previewMode({ thumbnail: REF, state: 'vod', imageFailed: true }), 'probe');
  });
});

/**
 * A preview card outlives the picture it was given, so an image failure has to be a fact about one
 * reference rather than about the card.
 *
 * `StreamList` keys a card by topic. In admin mode the topic belongs to the declaration and outlives
 * every session on it, so a publisher who replaces an unfetchable thumbnail re-renders the same
 * mounted component with a new reference and no remount. Recorded as a boolean, the first failure
 * latched: the replacement picture was never rendered, and for a scheduled entry, which is never
 * probed, the card stayed a placeholder for as long as the list was open.
 */
describe('whether a recorded image failure still applies', () => {
  const OTHER_REF = 'a'.repeat(64);

  it('demotes the reference that actually failed', () => {
    assert.equal(pictureFailed(REF, REF), true);
    assert.equal(previewMode({ thumbnail: REF, state: 'live', imageFailed: pictureFailed(REF, REF) }), 'probe');
  });

  it('does not demote a card that has never had a failure', () => {
    assert.equal(pictureFailed(null, REF), false);
  });

  /** ⛔ The regression itself: a new picture must be rendered rather than inheriting the old verdict. */
  it('stops applying once the publisher hands the card a different reference', () => {
    assert.equal(pictureFailed(REF, OTHER_REF), false);
    assert.equal(
      previewMode({ thumbnail: OTHER_REF, state: 'live', imageFailed: pictureFailed(REF, OTHER_REF) }),
      'image',
      'a replaced thumbnail must be rendered, not probed past',
    );
  });

  /**
   * The case that was worst, because a scheduled card has no probe to fall back to: it showed the
   * default image and nothing could ever move it off.
   */
  it('lets a scheduled card show a replacement picture instead of the placeholder for ever', () => {
    assert.equal(
      previewMode({ thumbnail: OTHER_REF, state: 'scheduled', imageFailed: pictureFailed(REF, OTHER_REF) }),
      'image',
    );
  });

  it('still demotes when the publisher re-publishes the same broken reference', () => {
    assert.equal(pictureFailed(REF, REF), true);
  });

  it('treats a picture with no URL as carrying no failure', () => {
    assert.equal(pictureFailed(REF, null), false);
  });

  it('stops applying once Previews read from another source, which gives the picture another URL', () => {
    const fromWeeb3 = `/weeb-3/bzz/${REF}/`;
    const fromGateway = `https://gateway.example.com/bzz/${REF}/`;
    assert.equal(pictureFailed(fromWeeb3, fromGateway), false);
  });
});

/**
 * A node in this tab gives a picture no URL until it is ready, since until then the browser would ask
 * the site itself and fail. Measured on 2026-10-18: a card handed weeb-3's URL at a live switch showed
 * the placeholder for good.
 */
describe('a picture whose source is a node in this tab', () => {
  it('waits while the node is stopped or starting, rather than counting as no picture', () => {
    assert.equal(pictureSourceOf(null, 'stopped'), 'waiting');
    assert.equal(pictureSourceOf(null, 'starting'), 'waiting');
    assert.equal(previewMode({ thumbnail: REF, state: 'scheduled', picture: 'waiting' }), 'waiting');
    assert.equal(previewMode({ thumbnail: REF, state: 'live', picture: 'waiting' }), 'waiting');
  });

  it('renders the picture once the node gives its URL', () => {
    assert.equal(pictureSourceOf('/weeb-3/bzz/x/', 'ready'), 'given');
    assert.equal(previewMode({ thumbnail: REF, state: 'scheduled', picture: 'given' }), 'image');
  });

  it('counts as no picture from a source that gives none, such as a node that failed', () => {
    assert.equal(pictureSourceOf(null, 'failed'), 'none');
    assert.equal(previewMode({ thumbnail: REF, state: 'scheduled', picture: 'none' }), 'placeholder');
    assert.equal(previewMode({ thumbnail: REF, state: 'live', picture: 'none' }), 'probe');
  });
});
