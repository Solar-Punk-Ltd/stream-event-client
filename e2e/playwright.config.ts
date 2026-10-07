import { defineConfig, devices } from '@playwright/test';

import { previewServer } from './previewServer';
import { PREVIEW_ORIGIN } from './recording';

/**
 * The browser suites: the built app, one real browser, and no node, no network and no server other than the app's own.
 * The smoke test replays every Bee answer from `e2e/recorded/`, and the ladder and Sources screen journeys answer from a
 * fake gateway that publishes a live stream in four qualities. `pnpm e2e` builds the app first. They check that the journeys work, never
 * how fast they are.
 */
export default defineConfig({
  testDir: '.',
  testMatch: ['smoke.e2e.ts', 'ladder.e2e.ts', 'panel.e2e.ts'],
  outputDir: '../test-results/playwright',
  timeout: 90_000,
  // One worker, which keeps a CI runner's core count from deciding how many browsers start, and keeps the ladder
  // journeys, which run in real time, from sharing the machine with each other.
  workers: 1,
  forbidOnly: !!process.env.CI,
  reporter: process.env.CI ? [['list'], ['github']] : [['list']],
  globalSetup: './installBrowser.ts',
  webServer: previewServer(),
  use: {
    ...devices['Desktop Chrome'],
    baseURL: PREVIEW_ORIGIN,
    trace: 'retain-on-failure',
    // A page opened by a test has had no click, and the player starts on its own the way it does for a viewer who
    // clicked a card.
    launchOptions: { args: ['--autoplay-policy=no-user-gesture-required'] },
  },
});
