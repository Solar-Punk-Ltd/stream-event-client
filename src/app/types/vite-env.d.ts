/// <reference types="vite/client" />

/** The version and build time the bundler writes in, which the diagnostics a viewer copies name. */
declare const __BUILD_LABEL__: string;

/** The size of weeb-3's WebAssembly module in bytes, which the build reads from the installed package. */
declare const __WEEB3_WASM_BYTES__: number | null;

/** The installed weeb-3 package's version, which the build reads from it. */
declare const __WEEB3_VERSION__: string | null;
