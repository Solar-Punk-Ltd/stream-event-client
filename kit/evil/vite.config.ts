import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vite';

/** The hostile site is a tiny page that only embeds Swarm ID, so it needs no plugins, just a bundle of the library. */
export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  build: { outDir: 'dist', emptyOutDir: true, target: 'es2022' },
});
