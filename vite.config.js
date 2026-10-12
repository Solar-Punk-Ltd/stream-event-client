import react from '@vitejs/plugin-react-swc';
import path from 'path';
import { fileURLToPath } from 'url';
import { defineConfig, loadEnv } from 'vite';

import { describeBuild } from './scripts/build-label.mjs';
import { weeb3Files } from './scripts/weeb3-files.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, __dirname, '');
  // The Bee node the dev server and `vite preview` forward `/bee` to, so a config naming `/bee` reads a
  // node on this machine without that node having to allow the page's origin.
  const beeProxyTarget = env.DEV_BEE_PROXY_TARGET || 'http://127.0.0.1:1633';
  const proxy = {
    '/bee': {
      target: beeProxyTarget,
      changeOrigin: true,
      rewrite: (path) => path.replace(/^\/bee/, ''),
    },
  };

  return {
    base: './',
    plugins: [react(), weeb3Files(__dirname)],
    // What Copy diagnostics names the build by: the release tag and the short commit. scripts/build-label.mjs says
    // where each comes from.
    define: { __BUILD_LABEL__: JSON.stringify(describeBuild({ root: __dirname, env: process.env })) },
    build: {
      // Stated rather than inherited, because the bundler default is not stable
      // across majors and moving it is silent: vite 5 defaulted to this list and
      // vite 8 defaults to `baseline-widely-available`, which emits
      // `@media (width>=500px)` range syntax that older engines drop whole,
      // taking the rule with it and reporting nothing. Raising this floor is a
      // product decision, so it belongs in a commit that says so.
      target: ['es2020', 'edge88', 'firefox78', 'chrome87', 'safari14'],
      // A font file inlined into the stylesheet is downloaded by every page, including the subsets it
      // never shows, because inlining throws away the unicode-range that lets the browser skip them.
      assetsInlineLimit: (file) => (/\.woff2?$/.test(file) ? false : undefined),
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, 'src'),
      },
    },
    server: { proxy },
    preview: { proxy },
  };
});
