import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { compile } from 'sass';
import { describe, expect, it } from 'vitest';

const SRC = join(dirname(dirname(dirname(fileURLToPath(import.meta.url)))), 'src');
const DETAILS = join(SRC, 'features/chat/Chat/ChatMessage/MessageDetails/MessageDetails.scss');

/** The declarations of the first rule whose selector is exactly `selector`. */
function rule(css: string, selector: string): string {
  const start = css.indexOf(`${selector} {`);
  return start === -1 ? '' : css.slice(start, css.indexOf('}', start));
}

describe("a message's details card", () => {
  it('keeps the plain pointer, though the message around it shows a hand for its actions', () => {
    const css = compile(DETAILS, {
      importers: [{ findFileUrl: (url) => (url.startsWith('@/') ? pathToFileURL(join(SRC, url.slice(2))) : null) }],
    }).css;
    expect(rule(css, '.message-details')).toContain('cursor: auto');
  });
});
