import react from '@vitejs/plugin-react-swc';
import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { defineConfig, loadEnv } from 'vite';

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

  const { version } = JSON.parse(readFileSync(path.join(__dirname, 'package.json'), 'utf8'));

  return {
    base: './',
    plugins: [react(), weeb3Files(__dirname)],
    // What the control panel's report names the build by.
    define: { __BUILD_LABEL__: JSON.stringify(`stream-event-client ${version}, built ${new Date().toISOString()}`) },
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
