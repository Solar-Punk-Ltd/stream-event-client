// @vitest-environment jsdom
// @vitest-environment-options {"url":"https://example.com/"}
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { nicknameLogin } from '../../src/features/chat/auth/login';
import { persistUserSession, restoreUserSession } from '../../src/features/chat/auth/persistence';
import { frameRefusedWarning } from '../../src/features/chat/swarmId/swarmIdSignIn';
import type { useChatUser } from '../../src/features/chat/User';
import { connectPage, seen } from '../helpers/connectPage';
import { button, click, dialog, input, queryButton, settle, text, type, type Mounted, waitFor } from '../helpers/dom';
import { type FakeSwarmId, fakeSwarmId, SIGNED_IN } from '../helpers/fakeSwarmId';
import { BOUND_SITE, CHAT_BINDING, chatKeyFor } from '../helpers/signedChat';

let mounted: Mounted | null = null;
const realFetch = globalThis.fetch;

/** Who the viewer chats as now. */
const chatsAs = (): ReturnType<typeof useChatUser>['session'] => seen.chatUser?.session ?? null;

async function header(swarmId: FakeSwarmId | null) {
  mounted = connectPage({ swarmId });
  await settle();
  await settle();
}

/** The session lands once the frame has answered with the chat key, some turns after the handover. */
const signedIn = () => waitFor(() => (chatsAs()?.binding ? chatsAs() : null));

/** Every value this browser keeps, so a test can say a key is in none of them. */
function everythingStored(): string {
  return Array.from({ length: localStorage.length }, (_, at) => {
    const key = localStorage.key(at) ?? '';
    return `${key}=${localStorage.getItem(key) ?? ''}`;
  }).join('\n');
}

beforeEach(() => {
  localStorage.clear();
  globalThis.fetch = (async () => new Response('', { status: 404 })) as typeof fetch;
});

afterEach(() => {
  mounted?.unmount();
  mounted = null;
  globalThis.fetch = realFetch;
  document.body.innerHTML = '';
});

describe('a deployment without Swarm ID', () => {
  it('offers the guest name alone, as before', async () => {
    await header(null);
    click(button('Connect'));

    expect(queryButton('Sign in with Swarm ID')).toBeNull();
    type(input('Your name'), 'Ada');
    click(button('Chat as guest'));
    expect(restoreUserSession()?.username).toBe('Ada');
  });
});

describe('signing in with Swarm ID from Connect', () => {
  it('offers both ways in, a guest name and Swarm ID', async () => {
    await header(await fakeSwarmId());
    click(button('Connect'));

    expect(dialog()?.textContent).toContain('Or sign in with your Swarm ID.');
    expect(queryButton('Chat as guest')).toBeTruthy();
    expect(button('Sign in with Swarm ID').disabled).toBe(false);
  });

  it('says why Sign in waits while Swarm ID is still starting', async () => {
    persistUserSession(nicknameLogin('Ada'));
    await header(
      await fakeSwarmId({}, (client) => {
        client.initializeHangs = true;
      }),
    );

    click(button(/^Ada/));
    const menuSignIn = button('Sign in with Swarm ID');
    expect(menuSignIn.disabled).toBe(true);
    expect(document.getElementById(menuSignIn.getAttribute('aria-describedby') ?? '')?.textContent).toBe(
      'Connecting to Swarm ID',
    );
    click(button('Close Connect'));

    mounted?.unmount();
    localStorage.clear();
    await header(
      await fakeSwarmId({}, (client) => {
        client.initializeHangs = true;
      }),
    );
    click(button('Connect'));
    const dialogSignIn = button('Sign in with Swarm ID');
    expect(dialogSignIn.disabled).toBe(true);
    expect(document.getElementById(dialogSignIn.getAttribute('aria-describedby') ?? '')?.textContent).toBe(
      'Connecting to Swarm ID',
    );
  });

  it('opens the Swarm ID window on the click, and chats with the key and binding it hands over', async () => {
    const swarmId = await fakeSwarmId();
    await header(swarmId);
    click(button('Connect'));

    click(button('Sign in with Swarm ID'));
    expect(swarmId.client().connectCalls).toBe(1);
    swarmId.client().handOver(SIGNED_IN);
    await signedIn();

    expect(dialog()?.textContent).toContain('Swarm ID · Ida');
    expect(chatsAs()?.username).toBe('Ida');
    expect(chatsAs()?.privateKey).toBe(await chatKeyFor(BOUND_SITE));
    expect(chatsAs()?.binding).toEqual(CHAT_BINDING);
  });

  it('never writes the chat key, the binding or the session anywhere the browser keeps', async () => {
    const swarmId = await fakeSwarmId();
    await header(swarmId);
    click(button('Connect'));
    click(button('Sign in with Swarm ID'));
    swarmId.client().handOver(SIGNED_IN);
    await signedIn();

    const key = await chatKeyFor(BOUND_SITE);
    expect(chatsAs()?.privateKey).toBe(key);
    expect(everythingStored()).not.toContain(key);
    expect(everythingStored()).not.toContain(CHAT_BINDING.sig);
    expect(restoreUserSession()).toBeNull();
  });

  it("shows the signed-in viewer's name, badge and account, and signs out", async () => {
    const swarmId = await fakeSwarmId(SIGNED_IN);
    await header(swarmId);
    await signedIn();

    click(button(/^Ida/));
    expect(text()).toContain('Swarm ID · Ida');
    click(button('Sign out'));
    await settle();

    expect(swarmId.client().disconnectCalls).toBe(1);
    expect(chatsAs()).toBeNull();
    expect(queryButton('Connect')).toBeTruthy();
  });
});

describe('a guest beside Swarm ID', () => {
  beforeEach(() => {
    persistUserSession(nicknameLogin('Ada'));
  });

  it('can show it is really them by signing in, which keeps the guest key, and is the guest again after', async () => {
    const swarmId = await fakeSwarmId();
    await header(swarmId);
    const guestKey = restoreUserSession()?.privateKey;

    click(button(/^Ada/));
    expect(text()).toContain('Guest');
    expect(text()).toContain("Show it's really you");
    click(button('Sign in with Swarm ID'));
    swarmId.client().handOver(SIGNED_IN);
    await signedIn();

    expect(chatsAs()?.username).toBe('Ida');
    expect(restoreUserSession()?.privateKey).toBe(guestKey);

    click(button('Sign out'));
    await settle();
    expect(chatsAs()?.privateKey).toBe(guestKey);
  });

  it('leaves as a guest, which forgets the name and the key as before', async () => {
    await header(await fakeSwarmId());

    click(button(/^Ada/));
    click(button('Leave'));
    expect(dialog()?.textContent).toContain('Leave the chat as a guest?');
    click(button('Leave'));

    expect(restoreUserSession()).toBeNull();
    expect(chatsAs()).toBeNull();
  });
});

describe("the header's connect button", () => {
  const badgeIn = (name: RegExp) => button(name).querySelector('svg')?.getAttribute('class');

  it('shows a guest with the grey hexagon, with and without Swarm ID offered', async () => {
    persistUserSession(nicknameLogin('Ada'));
    await header(null);
    expect(badgeIn(/^Ada/)).toBe('sender-badge-guest');
    mounted?.unmount();

    await header(await fakeSwarmId());
    expect(badgeIn(/^Ada/)).toBe('sender-badge-guest');
  });

  it('shows a Swarm ID sign-in with the filled hexagon', async () => {
    await header(await fakeSwarmId(SIGNED_IN));
    await signedIn();

    expect(badgeIn(/^Ida/)).toBe('sender-badge-swarm-id');
  });
});

describe('a blocked Swarm ID window', () => {
  it('shows one line with a button, and the button opens the window from its own click', async () => {
    const swarmId = await fakeSwarmId({}, (client) => {
      client.nextWindow = 'blocked';
    });
    await header(swarmId);
    click(button('Connect'));

    click(button('Sign in with Swarm ID'));
    await settle();
    expect(text()).toContain('Your browser blocked the Swarm ID window.');
    expect(text()).toContain('Open it with this button.');

    swarmId.client().nextWindow = 'opens';
    click(button('Open Swarm ID'));
    expect(swarmId.client().connectCalls).toBe(2);
    await settle();
    expect(text()).not.toContain('Your browser blocked the Swarm ID window.');
  });

  it('shows the line under the header once Connect is closed', async () => {
    const swarmId = await fakeSwarmId({}, (client) => {
      client.nextWindow = 'blocked';
    });
    await header(swarmId);
    click(button('Connect'));
    click(button('Sign in with Swarm ID'));
    await settle();
    click(button('Close Connect'));

    expect(dialog()).toBeNull();
    expect(queryButton('Open Swarm ID')).toBeTruthy();
  });
});

describe('a Swarm ID frame the page policy refuses', () => {
  it('warns once in the console as soon as the policy refuses the frame, however often it does', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      await header(await fakeSwarmId());
      const refusal = () =>
        document.dispatchEvent(
          Object.assign(new Event('securitypolicyviolation'), {
            effectiveDirective: 'frame-src',
            violatedDirective: 'frame-src',
            blockedURI: 'https://id.example.com/proxy',
          }),
        );
      refusal();
      refusal();

      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn).toHaveBeenCalledWith(frameRefusedWarning('https://id.example.com'));
    } finally {
      warn.mockRestore();
    }
  });

  it('says nothing of a refusal of any other frame or directive', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      await header(await fakeSwarmId());
      for (const [effectiveDirective, blockedURI] of [
        ['frame-src', 'https://other.example.com/'],
        ['img-src', 'https://id.example.com/avatar.png'],
      ]) {
        document.dispatchEvent(
          Object.assign(new Event('securitypolicyviolation'), {
            effectiveDirective,
            violatedDirective: effectiveDirective,
            blockedURI,
          }),
        );
      }

      expect(warn).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });
});

describe('a Swarm ID site that cannot be used', () => {
  it('says so in Connect and offers no sign-in, while guests chat as before', async () => {
    await header(
      await fakeSwarmId({}, (client) => {
        client.initializeFails = true;
      }),
    );
    click(button('Connect'));

    expect(queryButton('Sign in with Swarm ID')).toBeNull();
    expect(dialog()?.textContent).toContain('Swarm ID cannot be reached right now.');
    type(input('Your name'), 'Ada');
    click(button('Chat as guest'));
    expect(restoreUserSession()?.username).toBe('Ada');
  });
});
