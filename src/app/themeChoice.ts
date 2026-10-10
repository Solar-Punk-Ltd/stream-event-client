/**
 * The look a viewer picked, kept in this browser across reloads and logouts, and which look the page
 * wears given the deployment's own theme and whether it lets viewers switch.
 */
import { type RuntimeConfig, selectedTheme, themeSwitcherEnabled } from '@/config/runtimeConfig';
import { isThemeName, type ThemeName } from '@/design/themeNames';

import { type BrowserStorage, browserStorage, readStored, writeStored } from './browserStorage';

export const THEME_CHOICE_STORAGE_KEY = 'viewer-theme';

/** The look this browser picked before, or null when it picked none or the build no longer carries it. */
export function loadThemeChoice(storage: BrowserStorage | null = browserStorage()): ThemeName | null {
  const saved = readStored(storage, THEME_CHOICE_STORAGE_KEY);
  return isThemeName(saved) ? saved : null;
}

export function saveThemeChoice(name: ThemeName, storage: BrowserStorage | null = browserStorage()): void {
  writeStored(storage, THEME_CHOICE_STORAGE_KEY, name);
}

/**
 * The viewer's own pick where the deployment lets viewers switch, and the deployment's theme otherwise.
 * A pick is kept but not worn on a deployment that has the switcher off.
 */
export function wornLook(config: RuntimeConfig, choice: ThemeName | null): ThemeName {
  return themeSwitcherEnabled(config) && choice !== null ? choice : selectedTheme(config);
}
