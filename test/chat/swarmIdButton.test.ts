// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';

import {
  createSwarmIdSignIn,
  frameRefusedWarning,
  SWARM_ID_SIGNED_IN,
  type SwarmIdSignIn,
} from '../../src/features/chat/swarmId/swarmIdSignIn';
import { type FakeSwarmId, fakeSwarmId, SIGNED_IN } from '../helpers/fakeSwarmId';
import { BOUND_SITE } from '../helpers/signedChat';

const settled = () => new Promise((resolve) => setTimeout(resolve, 0));

async function started(swarmId: FakeSwarmId, warn: (message: string) => void = () => {}): Promise<SwarmIdSignIn> {
  const signIn = createSwarmIdSignIn({
    url: 'https://id.example.com',
    appName: 'Devcon streams',
    scope: { origin: BOUND_SITE, allowLocalHttp: false },
    load: swarmId.load,
    warn,
  });
  signIn.start();
  await settled();
  await settled();
  return signIn;
}

const container = () => document.body.appendChild(document.createElement('div'));

afterEach(() => {
  document.body.innerHTML = '';
});

describe("Swarm ID's button", () => {
  it('is mounted through the library once it has started, with the action and look the viewer asks for', async () => {
    const swarmId = await fakeSwarmId();
    const signIn = await started(swarmId);
    const into = container();

    const mounted = signIn.mountButton(into, { action: 'sign-in', config: { text: 'Sign in with Swarm ID' } });

    expect(mounted).not.toBeNull();
    const [button] = swarmId.client().buttons;
    expect(button.container).toBe(into);
    expect(button.options).toMatchObject({ action: 'sign-in', config: { text: 'Sign in with Swarm ID' } });
  });

  it('is not mounted while the library is still starting, which has no frame to show it with yet', async () => {
    const swarmId = await fakeSwarmId({}, (client) => {
      client.initializeHangs = true;
    });
    const signIn = await started(swarmId);

    expect(signIn.mountButton(container(), { action: 'sign-in' })).toBeNull();
    expect(swarmId.client().buttons).toEqual([]);
  });

  it('is not mounted once the viewer stopped', async () => {
    const swarmId = await fakeSwarmId();
    const signIn = await started(swarmId);
    signIn.stop();

    expect(signIn.mountButton(container(), { action: 'sign-in' })).toBeNull();
  });

  it('signs the viewer in through the window its own click opens, never through a window the page opens', async () => {
    const swarmId = await fakeSwarmId();
    const signIn = await started(swarmId);
    signIn.mountButton(container(), { action: 'sign-in' });

    swarmId.client().shownButton().element.click();
    swarmId.client().handOver(SIGNED_IN);
    for (let turn = 0; turn < 20 && signIn.getState().status !== SWARM_ID_SIGNED_IN; turn += 1) {
      await settled();
    }

    expect(signIn.getState().status).toBe(SWARM_ID_SIGNED_IN);
    expect(swarmId.client().windowsOpened).toBe(1);
    expect(swarmId.client().connectCalls).toBe(0);
  });

  it('warns once, as a Swarm ID that does not start does, when Swarm ID refuses its frame, and keeps the session', async () => {
    const warnings: string[] = [];
    const swarmId = await fakeSwarmId(SIGNED_IN, (client) => {
      client.buttonFails = true;
    });
    const signIn = await started(swarmId, (message) => warnings.push(message));
    for (let turn = 0; turn < 20 && signIn.getState().status !== SWARM_ID_SIGNED_IN; turn += 1) {
      await settled();
    }

    const first = signIn.mountButton(container(), { action: 'change-stamp' });
    const second = signIn.mountButton(container(), { action: 'change-stamp' });
    await expect(first?.ready).rejects.toMatchObject({ code: 'init-failed' });
    await expect(second?.ready).rejects.toMatchObject({ code: 'init-failed' });

    expect(warnings).toEqual([frameRefusedWarning('https://id.example.com')]);
    expect(signIn.getState().status).toBe(SWARM_ID_SIGNED_IN);
  });

  it('says nothing of a button the viewer took away before it showed', async () => {
    const warnings: string[] = [];
    const swarmId = await fakeSwarmId({}, (client) => {
      client.buttonHangs = true;
    });
    const signIn = await started(swarmId, (message) => warnings.push(message));

    const mounted = signIn.mountButton(container(), { action: 'sign-in' });
    mounted?.unmount();
    await expect(mounted?.ready).rejects.toMatchObject({ code: 'invalid-state' });
    await settled();

    expect(warnings).toEqual([]);
  });
});
