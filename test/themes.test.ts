// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';

import { parseRuntimeConfig, selectedTheme } from '../src/config/runtimeConfig';
import { applyTheme, DEFAULT_THEME, THEME_NAMES, THEMES } from '../src/design/themes';

const VALID = {
  gatewayUrl: '/bee',
  catalog: { owner: '0x' + '1'.repeat(40), topic: 'event-streams' },
};

describe('choosing a theme', () => {
  it('uses the default theme when the config names none', () => {
    const result = parseRuntimeConfig(VALID);

    expect(result.ok && selectedTheme(result.config)).toBe(DEFAULT_THEME);
  });

  it('uses the theme the config names', () => {
    for (const theme of THEME_NAMES) {
      const result = parseRuntimeConfig({ ...VALID, theme });

      expect(result.ok && selectedTheme(result.config)).toBe(theme);
    }
  });

  it('refuses a theme this build does not carry, naming the ones it does', () => {
    const result = parseRuntimeConfig({ ...VALID, theme: 'no-such-theme' });

    expect(result.ok).toBe(false);
    expect(!result.ok && result.problem).toMatch(new RegExp(`theme: .*${THEME_NAMES.join('.*')}`));
  });

  it('marks the page with the theme, which is what the stylesheet selects on', () => {
    const root = document.createElement('html');

    applyTheme(DEFAULT_THEME, root);

    expect(root.dataset.theme).toBe(DEFAULT_THEME);
  });

  it("gives the tab the theme's own title and icon, and leaves the built-in ones otherwise", () => {
    document.head.innerHTML = '<link rel="icon" type="image/png" href="./favicon.png" />';
    document.title = 'Built-in title';
    const icon = () => document.querySelector<HTMLLinkElement>('link[rel~="icon"]');

    applyTheme(DEFAULT_THEME, document.documentElement);
    expect(document.title).toBe(THEMES[DEFAULT_THEME].pageTitle ?? 'Built-in title');
    expect(icon()?.getAttribute('href')).toBe(THEMES[DEFAULT_THEME].faviconUrl ?? './favicon.png');

    for (const name of THEME_NAMES) {
      const { pageTitle, faviconUrl } = THEMES[name];
      applyTheme(name, document.documentElement);
      if (pageTitle) {
        expect(document.title).toBe(pageTitle);
      }
      if (faviconUrl) {
        expect(icon()?.getAttribute('href')).toBe(faviconUrl);
      }
    }
  });

  it('gives every theme its logo and page copy', () => {
    for (const name of THEME_NAMES) {
      expect(THEMES[name].logoUrl).toBeTruthy();
      expect(THEMES[name].logoAlt.trim()).not.toBe('');
      expect(THEMES[name].heroTitle.trim()).not.toBe('');
      expect(THEMES[name].heroSubtitle.trim()).not.toBe('');
    }
  });

  it('gives every theme a footer whose links all go somewhere', () => {
    for (const name of THEME_NAMES) {
      const { footer } = THEMES[name];
      const links = [
        ...(footer.brandLinks ?? []),
        ...footer.columns.flatMap((column) => column.links),
        ...(footer.social?.links ?? []),
        ...footer.bottomLinks,
      ];

      if (footer.tagline !== undefined) {
        expect(footer.tagline.trim()).not.toBe('');
      }
      expect(footer.columns.length).toBeGreaterThan(0);
      for (const column of footer.columns) {
        if (column.title !== undefined) {
          expect(column.title.trim()).not.toBe('');
        }
        expect(column.links.length).toBeGreaterThan(0);
      }
      for (const link of footer.social?.links ?? []) {
        expect(link.iconUrl).toBeTruthy();
      }
      for (const link of links) {
        expect(link.label.trim()).not.toBe('');
        expect(new URL(link.href).protocol).toBe('https:');
      }
    }
  });
});
