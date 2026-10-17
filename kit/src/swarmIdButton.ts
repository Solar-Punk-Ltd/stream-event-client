import type { Locator } from '@playwright/test';

import { CHAT_TIMEOUT_MS, type Run } from './run.ts';

const POLL_MS = 250;
const TRY_AGAIN = 'Try again';

/** The finding a run records each time the kit had to press Try again for a Swarm ID button to show. */
export const TRIED_AGAIN = 'Swarm ID button tried again';

/** One press of Try again: the button waited for, and the viewer's words when it gave up on it. */
export interface TriedAgain {
  button: string;
  words: string;
}

/** Swarm ID's own button, inside its frame, in the part of the page that shows it. */
export const swarmIdButton = (within: Locator, name: string | RegExp) =>
  within.locator('iframe[title="Swarm ID"]').contentFrame().getByRole('button', { name });

/**
 * Waits for Swarm ID's button named `name` to show in its frame, and answers it.
 *
 * The viewer gives up on a button whose frame has not answered within the Swarm ID library's own start deadline, says
 * so in its own words and offers Try again in its place, so from then on the button cannot show until Try again is
 * pressed. Under load a frame can miss that deadline once, so the wait presses Try again once, as a person would, and
 * records the press under {@link TRIED_AGAIN} with the viewer's words. A second give-up fails the wait at once with
 * those words, rather than waiting on and reading the viewer's answer as a button that never came.
 */
export async function waitForSwarmIdButton(
  run: Pick<Run, 'findings'>,
  within: Locator,
  name: string,
  { timeout = CHAT_TIMEOUT_MS }: { timeout?: number } = {},
): Promise<Locator> {
  const button = swarmIdButton(within, name);
  const tryAgain = within.getByRole('button', { name: TRY_AGAIN, exact: true });
  const viewerWords = () =>
    within
      .locator('.swarm-id-hint')
      .first()
      .innerText()
      .catch(() => 'no words');
  let pressed = false;
  let deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await button.isVisible()) return button;
    if (await tryAgain.isVisible()) {
      const words = await viewerWords();
      if (pressed) throw new Error(`the viewer gave up on Swarm ID's "${name}" button again after Try again: ${words}`);
      const recorded = (run.findings[TRIED_AGAIN] as TriedAgain[] | undefined) ?? [];
      run.findings[TRIED_AGAIN] = [...recorded, { button: name, words }];
      await tryAgain.click();
      pressed = true;
      deadline = Date.now() + timeout;
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }
  throw new Error(`Swarm ID's "${name}" button did not show within ${timeout} ms`);
}
