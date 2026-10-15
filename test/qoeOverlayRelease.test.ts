import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, it } from 'vitest';

import { QoeOverlay } from '../src/features/player/overlays/qoe/QoeOverlay';
import { initialMetrics } from '../src/features/player/overlays/qoe/useHlsQoeMetrics';
import { BUILD_LABEL } from '../src/shared/buildLabel';

/** The overlay as it first renders, panel open, which is how `?qoe=1` opens it. */
function render(release?: string | null): string {
  const metrics = initialMetrics();
  return renderToStaticMarkup(createElement(QoeOverlay, release === undefined ? { metrics } : { metrics, release }));
}

/** The release line's label and value, or null when the overlay has none. */
function releaseLine(html: string): { label: string; value: string } | null {
  const line =
    /<div class="qoe-overlay__row qoe-overlay__release"><span class="qoe-overlay__label">([^<]*)<\/span><span class="qoe-overlay__value">([^<]*)<\/span><\/div>/.exec(
      html,
    );
  return line ? { label: line[1]!, value: line[2]! } : null;
}

/**
 * The panel names the build of the viewer that is playing, the same label Connect's
 * diagnostics show, so a saved or copied reading says which build it came from.
 */
describe('the build in the QoE overlay', () => {
  it('shows the viewer’s own build label when nothing else is passed', () => {
    assert.deepEqual(releaseLine(render()), { label: 'Build', value: BUILD_LABEL });
    // The control: tests run unbundled, which is the label a build without one gets.
    assert.equal(BUILD_LABEL, 'unbundled');
  });

  it('shows the label it is given', () => {
    assert.equal(releaseLine(render('v1.2.0'))?.value, 'v1.2.0');
  });

  it('shows no build line at all when there is none', () => {
    const html = render(null);

    assert.equal(releaseLine(html), null);
    assert.doesNotMatch(html, /qoe-overlay__release/);
    // The control: the panel itself is there, so the line is missing and not the panel.
    assert.match(html, /QoE Metrics/);
  });

  it('prints the label as text, so a label that is not one shows its characters and not markup', () => {
    const html = render('<b>x</b>');

    assert.equal(releaseLine(html)?.value, '&lt;b&gt;x&lt;/b&gt;');
    assert.doesNotMatch(html, /<b>/);
  });
});
