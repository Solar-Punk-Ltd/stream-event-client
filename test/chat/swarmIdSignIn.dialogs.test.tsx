// @vitest-environment jsdom
// @vitest-environment-options {"url":"https://example.com/"}
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { nicknameLogin } from '../../src/features/chat/auth/login';
import { persistUserSession, restoreUserSession } from '../../src/features/chat/auth/persistence';
import { frameRefusedWarning } from '../../src/features/chat/swarmId/swarmIdSignIn';
import type { useChatUser } from '../../src/features/chat/User';
import { CHAT, chatConfig, connectPage, seen } from '../helpers/connectPage';
import { button, click, dialog, input, queryButton, settle, text, type, type Mounted, waitFor } from '../helpers/dom';
import { type FakeSwarmId, type FakeSwarmIdClient, fakeSwarmId, SIGNED_IN } from '../helpers/fakeSwarmId';
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

/** The button Swarm ID's frame draws, which the fake stands in for with a button of its own. */
function swarmIdButton(name: string): HTMLButtonElement {
  const found = button(name);
  expect('fakeSwarmIdButton' in found.dataset, `${name} is Swarm ID's button, not one of the page's`).toBe(true);
  return found;
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
    expect(swarmIdButton('Sign in with Swarm ID').disabled).toBe(false);
  });

  it('says Swarm ID is starting where its button will be, and shows no button of its own meanwhile', async () => {
    persistUserSession(nicknameLogin('Ada'));
    const starting = (client: FakeSwarmIdClient) => {
      client.initializeHangs = true;
    };
    await header(await fakeSwarmId({}, starting));

    click(button(/^Ada/));
    expect(dialog()?.textContent).toContain('Connecting to Swarm ID');
    expect(dialog()?.querySelector('[role="status"]')?.textContent, 'said to a screen reader too').toBe(
      'Connecting to Swarm ID',
    );
    expect(dialog()?.querySelector('.swarm-id-button-frame')?.hasAttribute('hidden'), "the button's place, kept").toBe(
      false,
    );
    expect(queryButton('Sign in with Swarm ID')).toBeNull();
    click(button('Close Connect'));

    mounted?.unmount();
    localStorage.clear();
    await header(await fakeSwarmId({}, starting));
    click(button('Connect'));
    expect(dialog()?.textContent).toContain('Connecting to Swarm ID');
    expect(queryButton('Sign in with Swarm ID')).toBeNull();
  });

  it("signs in through Swarm ID's own button, whose window hands over the key and binding the viewer chats with", async () => {
    const swarmId = await fakeSwarmId();
    await header(swarmId);
    click(button('Connect'));

    click(swarmIdButton('Sign in with Swarm ID'));
    expect(swarmId.client().shownButton().action).toBe('sign-in');
    expect(swarmId.client().windowsOpened).toBe(1);
    expect(swarmId.client().connectCalls, 'the page opens no window of its own').toBe(0);
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
    click(swarmIdButton('Sign in with Swarm ID'));
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
    click(swarmIdButton('Sign in with Swarm ID'));
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

describe('the Swarm ID button in Connect', () => {
  it('is mounted once while Connect stays open, whatever else changes there', async () => {
    const swarmId = await fakeSwarmId();
    await header(swarmId);
    click(button('Connect'));

    type(input('Your name'), 'Ad');
    swarmId.client().handOver({ identity: SIGNED_IN.identity });
    await settle();
    expect(text()).toContain('Swarm ID signed you in without confirming a chat address for this site.');
    swarmId.client().handOver({});
    await settle();

    expect(swarmId.client().buttons).toHaveLength(1);
    expect(swarmId.client().buttons[0].unmounted).toBe(false);
  });

  it('goes with Connect when it closes, and comes back with it, leaving a signed-in session as it is', async () => {
    const swarmId = await fakeSwarmId();
    await header(swarmId);
    click(button('Connect'));
    click(button('Close Connect'));
    expect(swarmId.client().buttons[0].unmounted).toBe(true);

    click(button('Connect'));
    expect(swarmId.client().buttons).toHaveLength(2);
    expect(swarmId.client().shownButton()).toBe(swarmId.client().buttons[1]);

    click(swarmIdButton('Sign in with Swarm ID'));
    swarmId.client().handOver(SIGNED_IN);
    await signedIn();
    click(button('Close Connect'));
    await settle();
    expect(chatsAs()?.username, 'closing Connect signs nobody out').toBe('Ida');
    expect(swarmId.client().disconnectCalls).toBe(0);
  });

  it('says when the browser blocked the window, honestly: only the button opens it, so the line says what to allow', async () => {
    const swarmId = await fakeSwarmId({}, (client) => {
      client.nextWindow = 'blocked';
    });
    await header(swarmId);
    click(button('Connect'));

    click(swarmIdButton('Sign in with Swarm ID'));
    expect(text()).toContain('Your browser blocked the Swarm ID window.');
    expect(text()).toContain('Allow pop-ups for this site, then press the button again.');
    expect(queryButton('Open Swarm ID'), 'the page has no window of its own to open').toBeNull();

    swarmId.client().nextWindow = 'opens';
    click(swarmIdButton('Sign in with Swarm ID'));
    expect(swarmId.client().windowsOpened).toBe(1);
    expect(text()).not.toContain('Your browser blocked the Swarm ID window.');
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

describe('a Swarm ID button frame that does not show', () => {
  it('says Swarm ID cannot be reached in its place, warns once, and guests chat as before', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      await header(
        await fakeSwarmId({}, (client) => {
          client.buttonFails = true;
        }),
      );
      click(button('Connect'));
      await settle();

      expect(
        dialog()?.querySelector('.swarm-id-button-frame')?.hasAttribute('hidden'),
        'the refused frame is out of sight',
      ).toBe(true);
      expect(dialog()?.textContent).toContain('Swarm ID cannot be reached right now.');
      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn).toHaveBeenCalledWith(frameRefusedWarning('https://id.example.com'));
      expect(dialog()?.querySelector('.swarm-id-button-frame'), 'the container stays, for a second try').toBeTruthy();
      type(input('Your name'), 'Ada');
      click(button('Chat as guest'));
      expect(restoreUserSession()?.username).toBe('Ada');
    } finally {
      warn.mockRestore();
    }
  });
});

describe('trying the Swarm ID button again', () => {
  it('mounts a new button in the same place, taking the refused one away first, once Try again is pressed', async () => {
    const swarmId = await fakeSwarmId({}, (client) => {
      client.buttonFails = true;
    });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      await header(swarmId);
      click(button('Connect'));
      await settle();
      expect(dialog()?.textContent).toContain('Swarm ID cannot be reached right now.');
      const [refused] = swarmId.client().buttons;

      swarmId.client().buttonFails = false;
      click(button('Try again'));
      await settle();

      expect(refused.unmounted, 'the refused button is taken away').toBe(true);
      expect(swarmId.client().buttons).toHaveLength(2);
      const shown = swarmId.client().shownButton();
      expect(shown.container).toBe(refused.container);
      expect(dialog()?.textContent).not.toContain('Swarm ID cannot be reached right now.');
      expect(queryButton('Try again')).toBeNull();
      expect(swarmIdButton('Sign in with Swarm ID')).toBe(shown.element);
    } finally {
      warn.mockRestore();
    }
  });

  it('says so again when the new button is refused too, and can be tried once more', async () => {
    const swarmId = await fakeSwarmId({}, (client) => {
      client.buttonFails = true;
    });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      await header(swarmId);
      click(button('Connect'));
      await settle();
      click(button('Try again'));
      await settle();

      expect(swarmId.client().buttons).toHaveLength(2);
      expect(dialog()?.textContent).toContain('Swarm ID cannot be reached right now.');
      expect(queryButton('Try again')).toBeTruthy();
    } finally {
      warn.mockRestore();
    }
  });
});

describe('Swarm ID button under StrictMode, as the app renders it', () => {
  it('leaves exactly one live button once mounted, and none once the page goes', async () => {
    const swarmId = await fakeSwarmId();
    mounted = connectPage({ swarmId, strict: true });
    await settle();
    await settle();
    click(button('Connect'));
    await settle();

    const live = () => swarmId.client().buttons.filter(({ unmounted }) => !unmounted);
    expect(live()).toHaveLength(1);
    expect(document.querySelectorAll('[data-fake-swarm-id-button]')).toHaveLength(1);

    mounted.unmount();
    mounted = null;
    expect(live()).toHaveLength(0);
  });
});

describe("the Bee address Swarm ID reads this site's content through", () => {
  it("is the chat history's source, and follows it when the viewer picks another", async () => {
    const swarmId = await fakeSwarmId();
    await header(swarmId);

    expect(swarmId.client().options.beeApiUrl).toBe('https://chat-read.example.com');
    const id = seen.app!.addSource({ type: 'bee-node', name: 'Desk node', url: 'http://localhost:1633' });
    await settle();
    seen.app!.setRouting({ mode: 'one', source: id, parts: seen.app!.routing.parts });
    await settle();

    expect(swarmId.client().beeApiUrls).toEqual(['http://localhost:1633']);
  });

  it("is absolute, since Swarm ID reads it from its own origin, when the site names it by this site's path", async () => {
    const swarmId = await fakeSwarmId();
    mounted = connectPage({ swarmId, config: chatConfig({ chat: { ...CHAT, readUrl: '/bee/' } }) });
    await settle();
    await settle();

    expect(swarmId.client().options.beeApiUrl).toBe(`${location.origin}/bee`);
  });
});
