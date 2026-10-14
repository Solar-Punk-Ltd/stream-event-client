import { MessageType, verifyChatMessage } from '@solarpunkltd/swarm-chat-js';
import { createChatMessage } from '@solarpunkltd/swarm-chat-js/message';
import { describe, expect, it } from 'vitest';

import type { ChatConfig } from '../../src/config/runtimeConfig';
import { chatSettings } from '../../src/features/chat/chatSettings';
import {
  createSwarmIdSignIn,
  frameRefusedWarning,
  NO_CHAT_KEY,
  SIGN_IN_INCOMPLETE,
  SWARM_ID_BLOCKED,
  SWARM_ID_SIGNED_IN,
  SWARM_ID_SIGNED_OUT,
  SWARM_ID_UNAVAILABLE,
  type SwarmIdSignIn,
  type SwarmIdState,
  WINDOW_FAILED,
} from '../../src/features/chat/swarmId/swarmIdSignIn';
import { ACCOUNT_MISMATCH, BINDING_REFUSED, chatNameOf } from '../../src/features/chat/swarmId/swarmIdSession';
import {
  FORK_BINDING,
  FORK_IDENTITY,
  FORK_OTHER_SITE_BINDING,
  type FakeSwarmId,
  fakeSwarmId,
  otherSiteChatKey,
  SIGNED_IN,
} from '../helpers/fakeSwarmId';
import { addressOf, BOUND_SITE, CHAT_BINDING, chatKeyFor, FORK_ACCOUNT } from '../helpers/signedChat';

const CHAT: ChatConfig = {
  enabled: true,
  readUrl: '/chat-read',
  writeUrl: '/chat-write',
  gsocResourceId: 'd'.repeat(64),
  gsocTopic: 'gsoc-topic',
  feedOwner: '0x' + 'b'.repeat(40),
  pollIntervalMs: 750,
};

const PAGE = { origin: BOUND_SITE, allowLocalHttp: false };

const settled = () => new Promise((resolve) => setTimeout(resolve, 0));

/** A session lands once the frame has answered with the chat key, some turns after the handover. */
async function until(signIn: SwarmIdSignIn, status: SwarmIdState['status']): Promise<SwarmIdState> {
  for (let turn = 0; turn < 100 && signIn.getState().status !== status; turn += 1) {
    await settled();
  }
  return signIn.getState();
}

async function started(swarmId: FakeSwarmId, warn: (message: string) => void = () => {}): Promise<SwarmIdSignIn> {
  const signIn = createSwarmIdSignIn({
    url: 'https://id.example.com',
    appName: 'Devcon streams',
    scope: PAGE,
    load: swarmId.load,
    warn,
  });
  signIn.start();
  await settled();
  await settled();
  return signIn;
}

function signedInSession(state: SwarmIdState) {
  if (state.status !== SWARM_ID_SIGNED_IN) {
    throw new Error(`expected a signed-in viewer, the state is ${JSON.stringify(state)}`);
  }
  return state.session;
}

describe('signing in with Swarm ID', () => {
  it('builds the client for the configured site under this site name, and starts signed out', async () => {
    const swarmId = await fakeSwarmId();
    const signIn = await started(swarmId);

    expect(swarmId.client().options).toMatchObject({ url: 'https://id.example.com', appName: 'Devcon streams' });
    expect(signIn.getState()).toEqual({ status: SWARM_ID_SIGNED_OUT, problem: null });
  });

  it('opens the Swarm ID window in the same call as the click, so the browser lets it open', async () => {
    const swarmId = await fakeSwarmId();
    const signIn = await started(swarmId);

    signIn.signIn();
    expect(swarmId.client().connectCalls).toBe(1);
  });

  it("signs in with the site's chat key and the binding the window hands over, mapped to the chat's spelling", async () => {
    const swarmId = await fakeSwarmId();
    const signIn = await started(swarmId);
    const key = await chatKeyFor(BOUND_SITE);

    signIn.signIn();
    swarmId.client().handOver(SIGNED_IN);

    expect(signedInSession(await until(signIn, SWARM_ID_SIGNED_IN))).toEqual({
      username: 'Ida',
      privateKey: key,
      address: addressOf(key),
      binding: { msg: FORK_BINDING.message, sig: FORK_BINDING.signature },
      accountName: 'Ida',
    });
  });

  it('sends messages that carry the binding, through the gateway, and pass the check for this page', async () => {
    const swarmId = await fakeSwarmId();
    const signIn = await started(swarmId);
    signIn.signIn();
    swarmId.client().handOver(SIGNED_IN);

    const { user, infra } = chatSettings(CHAT, 'stream-one', signedInSession(await until(signIn, SWARM_ID_SIGNED_IN)));
    const sent = createChatMessage(user.privateKey, {
      topic: infra.chatTopic,
      type: MessageType.TEXT,
      text: 'hello from the back row',
      name: user.nickname,
      via: infra.via,
      ...(user.binding ? { idb: user.binding } : {}),
    }).message;

    expect(sent.idb).toEqual(CHAT_BINDING);
    expect(sent.via).toBe('gateway');
    const check = verifyChatMessage(sent, { origin: BOUND_SITE });
    expect(check.ok && check.identity?.account).toBe(FORK_ACCOUNT);
  });

  it('refuses a binding made for another site, so the chat never sends what every reader refuses', async () => {
    const swarmId = await fakeSwarmId();
    const signIn = await started(swarmId);
    swarmId.client().chatKey = await otherSiteChatKey();

    swarmId.client().handOver({ identity: FORK_IDENTITY, chatBinding: FORK_OTHER_SITE_BINDING });
    for (let turn = 0; turn < 100 && !(signIn.getState() as { problem?: string }).problem; turn += 1) {
      await settled();
    }

    expect(signIn.getState()).toEqual({ status: SWARM_ID_SIGNED_OUT, problem: BINDING_REFUSED });
  });

  it('refuses a binding signed by another account than the one the frame says is signed in', async () => {
    const swarmId = await fakeSwarmId();
    const signIn = await started(swarmId);

    swarmId.client().handOver({ identity: { ...FORK_IDENTITY, address: 'c'.repeat(40) }, chatBinding: FORK_BINDING });
    for (let turn = 0; turn < 100 && !(signIn.getState() as { problem?: string }).problem; turn += 1) {
      await settled();
    }

    expect(signIn.getState()).toEqual({ status: SWARM_ID_SIGNED_OUT, problem: ACCOUNT_MISMATCH });
  });

  it("reads the frame's account address in any spelling of its hex", async () => {
    const swarmId = await fakeSwarmId();
    const signIn = await started(swarmId);

    swarmId.client().handOver({
      identity: { ...FORK_IDENTITY, address: `0x${FORK_IDENTITY.address.toUpperCase()}` },
      chatBinding: FORK_BINDING,
    });

    expect((await until(signIn, SWARM_ID_SIGNED_IN)).status).toBe(SWARM_ID_SIGNED_IN);
  });

  it('says so when the window signs in without confirming a chat address for this site', async () => {
    const swarmId = await fakeSwarmId();
    const signIn = await started(swarmId);

    swarmId.client().handOver({ identity: FORK_IDENTITY });
    await settled();

    expect(signIn.getState()).toEqual({ status: SWARM_ID_SIGNED_OUT, problem: SIGN_IN_INCOMPLETE });
  });

  it('stays signed out with the no-key reason, and no key bytes in it, when the key the frame gives is unusable', async () => {
    const swarmId = await fakeSwarmId();
    const signIn = await started(swarmId);
    swarmId.client().chatKey = Uint8Array.from([0xab, 0xcd, 0xef, 0x12, 0x34]);
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => unhandled.push(reason);
    process.on('unhandledRejection', onUnhandled);
    try {
      swarmId.client().handOver(SIGNED_IN);
      for (let turn = 0; turn < 100 && !(signIn.getState() as { problem?: string }).problem; turn += 1) {
        await settled();
      }

      expect(signIn.getState()).toEqual({ status: SWARM_ID_SIGNED_OUT, problem: NO_CHAT_KEY });
      expect(JSON.stringify(signIn.getState())).not.toMatch(/abcdef1234/i);
      expect(unhandled).toEqual([]);
    } finally {
      process.off('unhandledRejection', onUnhandled);
    }
  });

  it('comes back signed in on a reload, from the session the library restores, with no window', async () => {
    const swarmId = await fakeSwarmId(SIGNED_IN);
    const signIn = await started(swarmId);

    expect(signedInSession(await until(signIn, SWARM_ID_SIGNED_IN)).username).toBe('Ida');
    expect(swarmId.client().connectCalls).toBe(0);
  });

  it('signs out through the library, and drops the key and the binding at once', async () => {
    const swarmId = await fakeSwarmId(SIGNED_IN);
    const signIn = await started(swarmId);
    await until(signIn, SWARM_ID_SIGNED_IN);

    const signingOut = signIn.signOut();
    expect(signIn.getState()).toEqual({ status: SWARM_ID_SIGNED_OUT, problem: null });
    await signingOut;

    expect(swarmId.client().disconnectCalls).toBe(1);
    expect(signIn.getState()).toEqual({ status: SWARM_ID_SIGNED_OUT, problem: null });
  });

  it('keeps a sign-out when the chat key of the session it ended arrives after it', async () => {
    const swarmId = await fakeSwarmId();
    const signIn = await started(swarmId);

    swarmId.client().handOver(SIGNED_IN);
    void signIn.signOut();
    for (let turn = 0; turn < 20; turn += 1) {
      await settled();
    }

    expect(signIn.getState().status).toBe(SWARM_ID_SIGNED_OUT);
  });
});

describe('a blocked Swarm ID window', () => {
  it('shows as blocked, and the button that retries opens the window from its own click', async () => {
    const swarmId = await fakeSwarmId({}, (client) => {
      client.nextWindow = 'blocked';
    });
    const signIn = await started(swarmId);

    signIn.signIn();
    await settled();
    expect(signIn.getState()).toEqual({ status: SWARM_ID_BLOCKED });

    swarmId.client().nextWindow = 'opens';
    signIn.signIn();
    expect(swarmId.client().connectCalls).toBe(2);
    await settled();
    expect(signIn.getState()).toEqual({ status: SWARM_ID_SIGNED_OUT, problem: null });
  });

  it('says the window did not open on any other failure, rather than failing quietly', async () => {
    const swarmId = await fakeSwarmId();
    const signIn = await started(swarmId);
    swarmId.client().connect = () => Promise.reject(new Error('timeout'));

    signIn.signIn();
    await settled();

    expect(signIn.getState()).toEqual({ status: SWARM_ID_SIGNED_OUT, problem: WINDOW_FAILED });
  });
});

describe('a Swarm ID site that cannot be used', () => {
  it('is unavailable when the library cannot start, as for a site not on its allow list', async () => {
    const swarmId = await fakeSwarmId({}, (client) => {
      client.initializeFails = true;
    });
    const signIn = await started(swarmId);

    expect(signIn.getState()).toEqual({ status: SWARM_ID_UNAVAILABLE });
    signIn.signIn();
    expect(swarmId.client().connectCalls).toBe(0);
  });

  it('warns once in the console, naming the two settings that must agree', async () => {
    const warnings: string[] = [];
    const swarmId = await fakeSwarmId({}, (client) => {
      client.initializeFails = true;
    });
    await started(swarmId, (message) => warnings.push(message));

    expect(warnings).toEqual([frameRefusedWarning('https://id.example.com')]);
    expect(warnings[0]).toContain('SWARM_ID_URL');
    expect(warnings[0]).toContain('swarmId.url');
  });

  it('takes the frame away when the viewer stops', async () => {
    const swarmId = await fakeSwarmId();
    const signIn = await started(swarmId);

    signIn.stop();
    expect(swarmId.client().destroyed).toBe(true);
  });
});

describe("a Swarm ID account's chat name", () => {
  it("is the account's name, trimmed and cut to the chat's 20 characters", () => {
    expect(chatNameOf({ ...FORK_IDENTITY, name: '  Ida  ' })).toBe('Ida');
    expect(chatNameOf({ ...FORK_IDENTITY, name: 'Ida from the very back row' })).toBe('Ida from the very ba');
    expect([...chatNameOf({ ...FORK_IDENTITY, name: '🐝'.repeat(30) })]).toHaveLength(20);
  });

  it('is the short account address for an account with no name', () => {
    expect(chatNameOf({ ...FORK_IDENTITY, name: '  ' })).toBe(
      `0x${FORK_ACCOUNT.slice(2, 6)}…${FORK_ACCOUNT.slice(-4)}`,
    );
  });
});

describe('what keeps the sign-in state honest', () => {
  /** A frame whose disconnect never reports back, so only the sign-out itself can move the state. */
  const silentDisconnect = (client: { disconnect: () => Promise<void>; disconnectCalls: number }) => {
    client.disconnect = async () => {
      client.disconnectCalls += 1;
    };
  };

  it('is signed out the moment Sign out is pressed, before the frame says anything', async () => {
    const swarmId = await fakeSwarmId(SIGNED_IN, silentDisconnect);
    const signIn = await started(swarmId);
    await until(signIn, SWARM_ID_SIGNED_IN);

    void signIn.signOut();

    expect(signIn.getState()).toEqual({ status: SWARM_ID_SIGNED_OUT, problem: null });
    for (let turn = 0; turn < 20; turn += 1) {
      await settled();
    }
    expect(signIn.getState()).toEqual({ status: SWARM_ID_SIGNED_OUT, problem: null });
    expect(swarmId.client().disconnectCalls).toBe(1);
  });

  it('drops a chat key asked for before a sign-out, even when the frame never reports the sign-out', async () => {
    const swarmId = await fakeSwarmId({}, silentDisconnect);
    const signIn = await started(swarmId);

    swarmId.client().handOver(SIGNED_IN);
    void signIn.signOut();
    for (let turn = 0; turn < 20; turn += 1) {
      await settled();
    }

    expect(signIn.getState()).toEqual({ status: SWARM_ID_SIGNED_OUT, problem: null });
  });

  it('applies what the frame reported while the library was still starting', async () => {
    const swarmId = await fakeSwarmId({}, (client) => {
      client.initialize = async () => {
        client.options.onConnectionChange(SIGNED_IN);
      };
      client.getChatKey = async () => client.chatKey;
    });
    const signIn = await started(swarmId);

    expect(swarmId.client().connectionInfo).toEqual({});
    expect((await until(signIn, SWARM_ID_SIGNED_IN)).status).toBe(SWARM_ID_SIGNED_IN);
  });

  it('changes nothing once stopped, whatever arrives after', async () => {
    const swarmId = await fakeSwarmId();
    const signIn = await started(swarmId);

    swarmId.client().handOver(SIGNED_IN);
    signIn.stop();
    for (let turn = 0; turn < 20; turn += 1) {
      await settled();
    }

    expect(signIn.getState()).toEqual({ status: SWARM_ID_SIGNED_OUT, problem: null });
  });

  it('accepts a signature written in upper-case hex, and sends it in the one spelling the chat reads', async () => {
    const swarmId = await fakeSwarmId();
    const signIn = await started(swarmId);
    const signature = `0x${FORK_BINDING.signature.slice(2).toUpperCase()}`;

    swarmId.client().handOver({ identity: FORK_IDENTITY, chatBinding: { ...FORK_BINDING, signature } });

    expect(signedInSession(await until(signIn, SWARM_ID_SIGNED_IN)).binding.sig).toBe(CHAT_BINDING.sig);
  });
});
