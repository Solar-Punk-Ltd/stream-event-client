import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compile } from 'sass';
import { describe, expect, it } from 'vitest';

const SPINNER = join(
  dirname(dirname(dirname(fileURLToPath(import.meta.url)))),
  'src/shared/components/Spinner/Spinner.scss',
);

/** The declarations the stylesheet gives `.spinner` inside a media query, by the query's condition. */
function spinnerRulesUnder(css: string, condition: string): string {
  const query = css.indexOf(`@media ${condition}`);
  if (query === -1) {
    return '';
  }
  const block = css.slice(query, css.indexOf('}\n}', query) + 1);
  return block.slice(block.indexOf('.spinner'));
}

describe('the shared spinner', () => {
  it('stands still for a viewer who asked for less motion, whatever the page around it says', () => {
    const css = compile(SPINNER).css;
    expect(spinnerRulesUnder(css, '(prefers-reduced-motion: reduce)')).toContain('animation: none');
  });
});
