/** The build this page is, as the diagnostics a viewer copies name it. Tests run unbundled and have none. */
export const BUILD_LABEL: string = typeof __BUILD_LABEL__ === 'undefined' ? 'unbundled' : __BUILD_LABEL__;

/** The weeb-3 package this build carries, or null unbundled or without it. */
export const WEEB3_VERSION: string | null = typeof __WEEB3_VERSION__ === 'undefined' ? null : __WEEB3_VERSION__;
