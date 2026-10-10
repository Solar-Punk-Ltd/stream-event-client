import { defineConfig, devices } from '@playwright/test';

import { previewServer } from './previewServer';
import { PREVIEW_ORIGIN } from './recording';

/**
 * The opt-in proof that the real weeb-3 package works in the built app: a real browser, the real package and the
 * public Swarm network. It is never part of `pnpm e2e` or CI, because it depends on the network and on a stream someone
 * else publishes. `pnpm proof:weeb3` builds the app first. It prints the timings it saw and asserts none of them.
 */
export default defineConfig({
  testDir: '.',
  testMatch: ['weeb3Live.proof.ts'],
  outputDir: '../test-results/weeb3-live',
  timeout: 480_000,
  workers: 1,
  reporter: [['list']],
  globalSetup: './installBrowser.ts',
  webServer: previewServer(),
  use: {
    ...devices['Desktop Chrome'],
    baseURL: PREVIEW_ORIGIN,
    trace: 'retain-on-failure',
    launchOptions: { args: ['--autoplay-policy=no-user-gesture-required'] },
  },
});
