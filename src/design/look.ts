import { type ThemeName } from './themeNames';

/**
 * Dresses the page in a theme's colours and typefaces, which every themed variable is selected on, and
 * gives the browser's own bar the theme's page colour. The words and images stay the deployment's.
 */
export function applyLook(name: ThemeName, root: HTMLElement = document.documentElement): void {
  root.dataset.theme = name;

  const doc = root.ownerDocument;
  const background = doc.defaultView?.getComputedStyle(root).getPropertyValue('--color-background').trim();
  const bar = doc.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
  if (bar && background) {
    bar.content = background;
  }
}
