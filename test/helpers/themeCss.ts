import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { compile } from 'sass';

const SRC = join(dirname(dirname(dirname(fileURLToPath(import.meta.url)))), 'src');

let compiled: string | null = null;

/**
 * Puts the page's own design into the test document, so code that reads the theme's variables reads what a browser
 * would give it. Compiled once per test file.
 */
export function wearThemeCss(): void {
  compiled ??= compile(join(SRC, 'design', 'theme.scss'), {
    importers: [{ findFileUrl: (url) => (url.startsWith('@/') ? pathToFileURL(join(SRC, url.slice(2))) : null) }],
  }).css;
  const style = document.createElement('style');
  style.textContent = compiled;
  document.head.appendChild(style);
}
