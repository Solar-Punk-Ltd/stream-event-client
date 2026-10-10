// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';

import { parseRuntimeConfig, selectedTheme } from '../src/config/runtimeConfig';
import { applyLook } from '../src/design/look';
import { applyThemeContent, DEFAULT_THEME, THEME_LABELS, THEME_NAMES, THEME_CONTENT } from '../src/design/themes';

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

  it('marks the page with the look, which is what the stylesheet selects on', () => {
    const root = document.createElement('html');

    applyLook(DEFAULT_THEME, root);

    expect(root.dataset.theme).toBe(DEFAULT_THEME);
  });

  it("gives the browser's bar the page colour of the look", () => {
    document.head.innerHTML = '<meta name="theme-color" content="#000001" />';
    document.documentElement.style.setProperty('--color-background', '#123456');

    applyLook(DEFAULT_THEME, document.documentElement);

    expect(document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')?.content).toBe('#123456');
    document.documentElement.style.removeProperty('--color-background');
  });

  it("gives the tab the deployment theme's own title and icon, and leaves the built-in ones otherwise", () => {
    document.head.innerHTML = '<link rel="icon" type="image/png" href="./favicon.png" />';
    document.title = 'Built-in title';
    const icon = () => document.querySelector<HTMLLinkElement>('link[rel~="icon"]');

    applyThemeContent(DEFAULT_THEME);
    expect(document.title).toBe(THEME_CONTENT[DEFAULT_THEME].pageTitle ?? 'Built-in title');
    expect(icon()?.getAttribute('href')).toBe(THEME_CONTENT[DEFAULT_THEME].faviconUrl ?? './favicon.png');

    for (const name of THEME_NAMES) {
      const { pageTitle, faviconUrl } = THEME_CONTENT[name];
      applyThemeContent(name);
      if (pageTitle) {
        expect(document.title).toBe(pageTitle);
      }
      if (faviconUrl) {
        expect(icon()?.getAttribute('href')).toBe(faviconUrl);
      }
    }
  });

  it("keeps the deployment's tab title and icon when a viewer switches the look", () => {
    document.head.innerHTML = '<link rel="icon" type="image/png" href="./favicon.png" />';
    document.title = 'Built-in title';
    applyThemeContent('swarm');

    for (const name of THEME_NAMES) {
      applyLook(name, document.documentElement);
      expect(document.title).toBe('Built-in title');
      expect(document.querySelector('link[rel~="icon"]')?.getAttribute('href')).toBe('./favicon.png');
    }
  });

  it('names every theme for the switcher', () => {
    for (const name of THEME_NAMES) {
      expect(THEME_LABELS[name].trim()).not.toBe('');
    }
  });

  it('gives every theme its logo and page copy', () => {
    for (const name of THEME_NAMES) {
      expect(THEME_CONTENT[name].logoUrl).toBeTruthy();
      expect(THEME_CONTENT[name].logoAlt.trim()).not.toBe('');
      expect(THEME_CONTENT[name].heroTitle.trim()).not.toBe('');
      expect(THEME_CONTENT[name].heroSubtitle.trim()).not.toBe('');
    }
  });

  it('gives every theme a footer whose links all go somewhere', () => {
    for (const name of THEME_NAMES) {
      const { footer } = THEME_CONTENT[name];
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
