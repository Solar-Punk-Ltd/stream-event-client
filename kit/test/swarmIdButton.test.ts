import type { Locator } from '@playwright/test';
import { describe, expect, it } from 'vitest';

import { TRIED_AGAIN, waitForSwarmIdButton } from '../src/swarmIdButton.ts';

const NAME = 'Choose a stamp in Swarm ID';
const UNAVAILABLE = 'Swarm ID cannot be reached right now.';

type AfterTryAgain = 'shows' | 'gives up again';

/**
 * The part of the viewer a Swarm ID button sits in, as far as the wait reads it: the button inside Swarm ID's frame,
 * shown from `shownAfter` ms, and the viewer's own Try again with its words, shown from `refusedAfter` ms. Pressing
 * Try again starts the frame over, and `afterTryAgain` says how that second start ends, 50 ms later.
 */
function slot({
  shownAfter,
  refusedAfter,
  afterTryAgain,
}: {
  shownAfter?: number;
  refusedAfter?: number;
  afterTryAgain?: AfterTryAgain;
}): { within: Locator; presses: () => number } {
  let started = Date.now();
  let presses = 0;
  const since = (ms: number | undefined) => ms !== undefined && Date.now() - started >= ms;
  const button = {
    isVisible: async () => (presses === 0 ? since(shownAfter) : afterTryAgain === 'shows' && since(50)),
  };
  const tryAgain = {
    isVisible: async () => (presses === 0 ? since(refusedAfter) : afterTryAgain === 'gives up again' && since(50)),
    click: async () => {
      presses += 1;
      started = Date.now();
    },
  };
  const hint = { first: () => ({ innerText: async () => UNAVAILABLE }) };
  const within = {
    locator: (selector: string) =>
      selector === '.swarm-id-hint' ? hint : { contentFrame: () => ({ getByRole: () => button }) },
    getByRole: (_role: string, options: { name: string }) => (options.name === 'Try again' ? tryAgain : button),
  } as unknown as Locator;
  return { within, presses: () => presses };
}

describe('waitForSwarmIdButton', () => {
  it('answers once the button shows in its frame, and records nothing', async () => {
    const run = { findings: {} };
    await expect(
      waitForSwarmIdButton(run, slot({ shownAfter: 50 }).within, NAME, { timeout: 2000 }),
    ).resolves.toBeDefined();
    expect(run.findings).toEqual({});
  });

  // A frame that starts slowly under load makes the viewer give up and offer Try again. A person presses it once, so
  // the kit does too, and records that it had to, since a button that needs a second start is worth knowing about.
  it("presses Try again once when the viewer gave up, records it with the viewer's words, and answers", async () => {
    const run = { findings: {} };
    const viewer = slot({ refusedAfter: 50, afterTryAgain: 'shows' });
    await expect(waitForSwarmIdButton(run, viewer.within, NAME, { timeout: 2000 })).resolves.toBeDefined();
    expect(viewer.presses()).toBe(1);
    expect(run.findings).toEqual({ [TRIED_AGAIN]: [{ button: NAME, words: UNAVAILABLE }] });
  });

  it("fails at once with the viewer's words when the viewer gives up again after Try again", async () => {
    const run = { findings: {} };
    const viewer = slot({ refusedAfter: 50, afterTryAgain: 'gives up again' });
    const started = Date.now();
    await expect(waitForSwarmIdButton(run, viewer.within, NAME, { timeout: 5000 })).rejects.toThrow(
      `the viewer gave up on Swarm ID's "${NAME}" button again after Try again: ${UNAVAILABLE}`,
    );
    expect(Date.now() - started).toBeLessThan(2000);
    expect(viewer.presses()).toBe(1);
  });

  it('fails naming the button when neither shows in time', async () => {
    await expect(waitForSwarmIdButton({ findings: {} }, slot({}).within, NAME, { timeout: 300 })).rejects.toThrow(
      `Swarm ID's "${NAME}" button did not show within 300 ms`,
    );
  });
});
