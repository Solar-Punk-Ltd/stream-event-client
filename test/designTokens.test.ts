import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { compile, compileString } from 'sass';
import { describe, expect, it } from 'vitest';

import { DEFAULT_THEME, THEME_NAMES } from '../src/design/themes';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const SRC = join(ROOT, 'src');
const THEME = join(SRC, 'design', 'theme.scss');

/** Resolves the `@/` alias the way the bundler does, so a stylesheet compiles here as it does in a build. */
const findUrlImporter = {
  findFileUrl(url: string) {
    return url.startsWith('@/') ? pathToFileURL(join(SRC, url.slice(2))) : null;
  },
};

function compileFile(path: string): string {
  return compile(path, { importers: [findUrlImporter] }).css;
}

function filesUnder(dir: string, keep: (name: string) => boolean): string[] {
  return readdirSync(dir, { withFileTypes: true, recursive: true })
    .filter((entry) => entry.isFile() && keep(entry.name))
    .map((entry) => join(entry.parentPath, entry.name));
}

const DEFINITION = /(--[\w-]+)\s*:/g;
const READ = /var\(\s*(--[\w-]+)/g;

function matches(pattern: RegExp, text: string): Set<string> {
  return new Set([...text.matchAll(pattern)].map(([, name]) => name));
}

/** The variables a stylesheet reads that neither the design nor the stylesheet itself defines. */
function undefinedReads(css: string, designTokens: Set<string>): string[] {
  const local = matches(DEFINITION, css);
  return [...matches(READ, css)].filter((name) => !designTokens.has(name) && !local.has(name));
}

const themeCss = compileFile(THEME);
const designTokens = matches(DEFINITION, themeCss);

const componentStylesheets = filesUnder(SRC, (name) => name.endsWith('.scss') && !name.startsWith('_')).filter(
  (path) => path !== THEME,
);
const componentSources = filesUnder(SRC, (name) => name.endsWith('.scss'))
  .filter((path) => !path.startsWith(join(SRC, 'design')))
  .map((path) => ({ path: relative(ROOT, path), scss: readFileSync(path, 'utf8') }));

const COLOUR_LITERAL = /#[0-9a-f]{3,8}\b|\b(?:rgba?|hsla?)\(|(?<![\w-])(?:white|black)(?![\w-])/gi;

/** The colours a stylesheet writes out itself, comments aside, which no theme can change. */
function literalColours(scss: string): string[] {
  const code = scss.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  return [...code.matchAll(COLOUR_LITERAL)].map(([found]) => found);
}

const componentCss = componentStylesheets.map((path) => ({ path: relative(ROOT, path), css: compileFile(path) }));
const scriptSources = filesUnder(SRC, (name) => /\.tsx?$/.test(name)).map((path) => ({
  path: relative(ROOT, path),
  css: readFileSync(path, 'utf8'),
}));

/** Each rule of the compiled theme, as its selector and the text between its braces. */
function rules(css: string): Array<{ selector: string; body: string }> {
  return [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(([, selector, body]) => ({ selector: selector.trim(), body }));
}

// Sass drops the quotes around a plain name, so both spellings are read.
const THEME_SELECTOR = /:root\[data-theme=["']?([\w-]+)["']?\]/g;

/** The body each theme's variables are written in, by the theme's name. */
function themeBodies(css: string): Map<string, string> {
  const bodies = new Map<string, string>();
  for (const { selector, body } of rules(css)) {
    for (const [, name] of selector.matchAll(THEME_SELECTOR)) {
      bodies.set(name, (bodies.get(name) ?? '') + body);
    }
  }
  return bodies;
}

const themes = themeBodies(themeCss);

describe('the design tokens', () => {
  it('put the scales on :root, and each theme under its own data-theme', () => {
    const plainRoot = rules(themeCss).filter(({ selector }) => selector === ':root');

    expect(plainRoot).toHaveLength(1);
    expect(matches(DEFINITION, plainRoot[0].body).size).toBeGreaterThan(0);
    expect(themes.size).toBeGreaterThan(0);
  });

  it('define exactly the themes a deployment can select', () => {
    expect([...themes.keys()].sort()).toEqual([...THEME_NAMES].sort());
  });

  it('apply the default theme before any theme is selected', () => {
    const defaultRule = rules(themeCss).find(({ selector }) =>
      [...selector.matchAll(THEME_SELECTOR)].some(([, name]) => name === DEFAULT_THEME),
    );

    expect(defaultRule?.selector.split(',').map((part) => part.trim())).toContain(':root');
  });

  it('give every theme the same variables, so switching theme leaves nothing unset', () => {
    const [first, ...rest] = [...themes.values()].map((body) => [...matches(DEFINITION, body)].sort());

    for (const names of rest) {
      expect(names).toEqual(first);
    }
  });

  it('catch a stylesheet that reads a variable the design does not define', () => {
    const css = compileString('.x { color: var(--color-nope); gap: var(--local); --local: 1px; }').css;

    expect(undefinedReads(css, designTokens)).toEqual(['--color-nope']);
  });

  it.each([...componentCss, ...scriptSources])('are the only variables $path reads', ({ css }) => {
    expect(undefinedReads(css, designTokens)).toEqual([]);
  });

  it('catch a colour a stylesheet writes out instead of reading from the theme', () => {
    expect(literalColours('.x { color: #fff; background: rgba(0, 0, 0, 0.5); border-color: black; }')).toEqual([
      '#fff',
      'rgba(',
      'black',
    ]);
    expect(literalColours('// was #fff\n.x { color: var(--color-text); }')).toEqual([]);
  });

  it.each(componentSources)(
    'leave every colour of $path to the theme, so switching the look reaches it',
    ({ scss }) => {
      expect(literalColours(scss)).toEqual([]);
    },
  );

  it('are each read somewhere, so the design carries no token this app does not use', () => {
    const everyRead = new Set(
      [themeCss, ...componentCss.map((file) => file.css), ...scriptSources.map((file) => file.css)].flatMap((css) => [
        ...matches(READ, css),
      ]),
    );

    expect([...designTokens].filter((name) => !everyRead.has(name))).toEqual([]);
  });
});

type Rgba = [number, number, number, number];

function parseColor(value: string): Rgba {
  const hex = value.match(/^#([0-9a-f]{6})$/i);
  if (hex) {
    const n = Number.parseInt(hex[1], 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255, 1];
  }
  const shortHex = value.match(/^#([0-9a-f]{3})$/i);
  if (shortHex) {
    const [r, g, b] = [...shortHex[1]].map((digit) => Number.parseInt(digit + digit, 16));
    return [r, g, b, 1];
  }
  const rgba = value.match(/^rgba?\(([^)]+)\)$/);
  if (rgba) {
    const [r, g, b, a = 1] = rgba[1].split(',').map((part) => Number.parseFloat(part));
    return [r, g, b, a];
  }
  throw new Error(`not a colour the contrast check reads: ${value}`);
}

function over(top: Rgba, bottom: Rgba): Rgba {
  const a = top[3];
  return [0, 1, 2].map((i) => top[i] * a + bottom[i] * (1 - a)).concat(1) as Rgba;
}

function luminance([r, g, b]: Rgba): number {
  const channel = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

function tokenValue(theme: string, name: string): string {
  const found = themes.get(theme)?.match(new RegExp(`--color-${name}:\\s*([^;]+);`));
  if (!found) {
    throw new Error(`--color-${name} is not defined in the ${theme} theme`);
  }
  return found[1].trim();
}

/** Contrast of a text colour on a surface in one theme, both composited over that theme's page background. */
function contrast(theme: string, text: string, surface: string): number {
  const page = parseColor(tokenValue(theme, 'background'));
  const back = over(parseColor(tokenValue(theme, surface)), page);
  const front = over(parseColor(tokenValue(theme, text)), back);
  const [light, dark] = [luminance(front), luminance(back)].sort((a, b) => b - a);
  return (light + 0.05) / (dark + 0.05);
}

/** Every pairing of text and surface the stylesheets put together. */
const TEXT_ON_SURFACE: Array<[text: string, surface: string]> = [
  ['text', 'background'],
  ['text', 'surface'],
  ['text', 'input'],
  ['text-secondary', 'background'],
  ['text-secondary', 'surface'],
  ['on-primary', 'primary'],
  ['on-primary', 'primary-hover'],
  ['primary', 'background'],
  ['primary', 'surface'],
  ['on-live', 'live'],
  ['error-text', 'surface'],
  ['text', 'overlay'],
  ['text-tertiary', 'surface'],
  ['primary', 'input'],
  ['text', 'surface-card'],
  ['text-secondary', 'surface-card'],
  ['primary', 'surface-card'],
  ['text-muted', 'surface'],
  ['text-tertiary', 'footer-end'],
  ['text', 'badge-dark'],
  ['text', 'surface-hover'],
  ['text', 'input-focus'],
  ['text', 'surface-glass'],
  ['text', 'message'],
  ['text-secondary', 'surface-glass'],
  ['text-secondary', 'error-surface'],
  ['text-tertiary', 'surface-glass'],
  ['text-soft', 'surface-glass'],
  ['on-scrim', 'scrim'],
  ['on-scrim-secondary', 'scrim'],
  ['on-button-light', 'button-light'],
  ['on-button-light', 'button-light-hover'],
  ['on-scrim', 'scrim-strong'],
  ['on-scrim-secondary', 'scrim-strong'],
  ['error-text', 'scrim-strong'],
  ['on-scrim', 'info'],
  ...Array.from({ length: 16 }, (_, i): [string, string] => ['text', `name-${i + 1}`]),
];

describe.each([...THEME_NAMES])('the text colours of the %s theme', (theme) => {
  it.each(TEXT_ON_SURFACE)('%s on %s reads at 4.5:1 or better', (text, surface) => {
    expect(contrast(theme, text, surface)).toBeGreaterThanOrEqual(4.5);
  });
});
