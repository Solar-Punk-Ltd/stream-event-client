/**
 * Every theme this build carries, by the name a deployment selects it with in config.json. The
 * stylesheet defines one `:root[data-theme]` block for each, in `themes/_index.scss`, and the tokens
 * test holds the two lists to each other.
 *
 * Kept apart from `themes.ts`, which imports images, so the config schema reads it anywhere Node runs.
 */
export const THEME_NAMES = ['swarm', 'web3privacy'] as const;

export type ThemeName = (typeof THEME_NAMES)[number];

/** Used when the config names no theme, and applied by the stylesheet before any is chosen. */
export const DEFAULT_THEME: ThemeName = 'swarm';
