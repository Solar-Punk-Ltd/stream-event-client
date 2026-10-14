// @vitest-environment jsdom
// @vitest-environment-options {"url":"https://example.com/"}
import { MessageVia } from '@solarpunkltd/swarm-chat-js';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { saveAddedSources, saveRouting } from '../../src/app/sourceStorage';
import { nicknameLogin } from '../../src/features/chat/auth/login';
import { persistUserSession } from '../../src/features/chat/auth/persistence';
import { swarmIdAppsUrl } from '../../src/features/chat/stamp/ChatStamp';
import { loadChatStampChoice, saveChatStampChoice } from '../../src/features/chat/stamp/chatStampChoice';
import { EVENT_GATEWAY_STAMPS_ITSELF, PICK_A_SOURCE_THAT_SENDS } from '../../src/features/chat/stamp/ownStampRoute';
import type { SwarmIdPostageBatch } from '../../src/features/chat/swarmId/swarmIdClient';
import { chooseSource, defaultRouting } from '../../src/swarm/routing';
import { connectPage, seen } from '../helpers/connectPage';
import { button, click, dialog, settle, type Mounted, waitFor } from '../helpers/dom';
import { fakeSwarmId, SIGNED_IN } from '../helpers/fakeSwarmId';
import { addressOf, BOUND_SITE, chatKeyFor } from '../helpers/signedChat';

const DAY_S = 24 * 60 * 60;
const BATCH: SwarmIdPostageBatch = {
  label: 'Event chat',
  utilization: 0.42,
  usable: true,
  exists: true,
  batchTTL: 40 * DAY_S,
};

let mounted: Mounted | null = null;
let signedInAddress = '';

beforeAll(async () => {
  signedInAddress = addressOf(await chatKeyFor(BOUND_SITE));
});
const realFetch = globalThis.fetch;

const group = () => dialog()?.querySelector<HTMLElement>('section[aria-label="Chat stamp"]') ?? null;
const radio = (name: string) =>
  [...(group()?.querySelectorAll<HTMLInputElement>('input[type="radio"]') ?? [])].find((candidate) =>
    candidate.closest('label')?.textContent?.startsWith(name),
  ) ?? null;
const ownFeedBox = () => group()?.querySelector<HTMLInputElement>('input[type="checkbox"]') ?? null;

/** The viewer's own Bee node, added, and picked for every feature, the chat history with them. */
function chatOnMyBeeNode() {
  saveAddedSources([{ id: 'added-1', type: 'bee-node', name: 'My Bee node', url: 'http://localhost:1633' }]);
  saveRouting(chooseSource(defaultRouting('event'), 'added-1'));
}

/** `batch` null for a site Swarm ID gives no stamp. */
async function openConnect(batch: SwarmIdPostageBatch | null = BATCH, signedIn = true) {
  const swarmId = await fakeSwarmId(signedIn ? SIGNED_IN : {}, (client) => {
    client.postageBatch = batch ?? undefined;
  });
  mounted = connectPage({ swarmId });
  await settle();
  await settle();
  if (signedIn) {
    await waitFor(() => seen.chatUser?.swarmIdSession);
  }
  click(button(/^(Connect|Ida|Ada)/));
  await settle();
  await settle();
  return swarmId;
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
  vi.restoreAllMocks();
});

describe('the chat stamp in Connect', () => {
  it('is not shown to a viewer who is not chatting', async () => {
    await openConnect(BATCH, false);
    expect(group()).toBeNull();
  });

  it('lets the gateway pay for a guest, who must sign in with Swarm ID for their own stamp', async () => {
    persistUserSession(nicknameLogin('Ada'));
    await openConnect(BATCH, false);

    expect(radio('Gateway pays')?.checked).toBe(true);
    expect(radio('My stamp')?.disabled).toBe(true);
    expect(group()?.textContent).toContain('Sign in with Swarm ID first.');
  });

  it('says why my stamp cannot send through the event gateway, and keeps the gateway paying', async () => {
    await openConnect();

    expect(radio('Gateway pays')?.checked).toBe(true);
    expect(radio('My stamp')?.disabled).toBe(true);
    expect(group()?.textContent).toContain(EVENT_GATEWAY_STAMPS_ITSELF);
    expect(group()?.textContent).toContain(PICK_A_SOURCE_THAT_SENDS);
  });

  it('shows how full the stamp Swarm ID gives this site is and its days left, once my stamp pays', async () => {
    chatOnMyBeeNode();
    await openConnect();

    click(radio('My stamp')!);
    await settle();

    expect(radio('My stamp')?.checked).toBe(true);
    expect(loadChatStampChoice(signedInAddress).payWith).toBe(MessageVia.OWN_STAMP);
    expect(seen.chatStamp?.sending).toEqual({
      via: MessageVia.OWN_STAMP,
      url: 'http://localhost:1633',
      ownFeed: false,
    });
    const box = group()?.textContent ?? '';
    expect(box).toContain('Event chat');
    expect(box).toContain('40 days left');
    expect(box).toContain('42% used');
    expect(group()?.querySelector('[role="progressbar"]')?.getAttribute('aria-valuenow')).toBe('42');
  });

  it('offers my stamp with Weeb3 picked for the chat history, which sends the message itself', async () => {
    saveAddedSources([{ id: 'added-1', type: 'weeb-3', name: 'Weeb3', url: '' }]);
    saveRouting(chooseSource(defaultRouting('event'), 'added-1'));
    await openConnect();

    expect(radio('My stamp')?.disabled).toBe(false);
    click(radio('My stamp')!);
    await settle();

    expect(seen.chatStamp?.route).toEqual({ ok: true, through: 'weeb-3' });
    expect(seen.chatStamp?.sending).toEqual({ via: MessageVia.OWN_STAMP, url: null, ownFeed: false });
    expect(seen.chatStamp?.warning).toBeNull();
  });

  it('starts another account on this browser on the gateway, whatever an earlier account picked', async () => {
    chatOnMyBeeNode();
    saveChatStampChoice('c'.repeat(40), { payWith: MessageVia.OWN_STAMP, ownFeed: true });
    await openConnect();

    expect(radio('Gateway pays')?.checked).toBe(true);
    expect(seen.chatStamp?.sending).toEqual({ via: MessageVia.GATEWAY });
  });

  it('keeps what the account picked across a reload', async () => {
    chatOnMyBeeNode();
    saveChatStampChoice(signedInAddress, { payWith: MessageVia.OWN_STAMP, ownFeed: true });
    await openConnect();

    expect(radio('My stamp')?.checked).toBe(true);
    expect(ownFeedBox()?.checked).toBe(true);
  });

  it('keeps an own feed only when asked, and only with my stamp', async () => {
    chatOnMyBeeNode();
    await openConnect();
    expect(ownFeedBox(), 'no own feed while the gateway pays').toBeNull();

    click(radio('My stamp')!);
    await settle();
    expect(ownFeedBox()?.checked).toBe(false);
    click(ownFeedBox()!);
    await settle();

    expect(loadChatStampChoice(signedInAddress)).toEqual({ payWith: MessageVia.OWN_STAMP, ownFeed: true });
    expect(seen.chatStamp?.sending).toMatchObject({ ownFeed: true });
  });

  it('says when Swarm ID has given this site no stamp, and offers to choose one there', async () => {
    chatOnMyBeeNode();
    await openConnect(null);
    click(radio('My stamp')!);
    await settle();

    expect(group()?.textContent).toContain('Swarm ID has given this site no stamp yet.');
    expect(button('Choose a stamp in Swarm ID')).toBeTruthy();
  });

  it("opens this site's row on Swarm ID's Apps screen in a window of its own, and reads the stamp again once it closes", async () => {
    chatOnMyBeeNode();
    const appsWindow = { closed: false, opener: {} as unknown };
    const opened = vi.spyOn(window, 'open').mockReturnValue(appsWindow as unknown as Window);
    const swarmId = await openConnect();
    click(radio('My stamp')!);
    await settle();

    vi.useFakeTimers();
    try {
      click(button('Change stamp in Swarm ID'));

      const appsUrl = `https://id.example.com/#apps/${encodeURIComponent('https://example.com')}`;
      expect(swarmIdAppsUrl('https://id.example.com/', 'https://example.com')).toBe(appsUrl);
      expect(opened).toHaveBeenCalledWith(appsUrl, 'swarm-id-apps', expect.stringContaining('popup'));
      expect(appsWindow.opener, 'the Swarm ID window cannot reach back into this page').toBeNull();

      swarmId.client().postageBatch = { ...BATCH, label: 'Another stamp' };
      appsWindow.closed = true;
      await vi.advanceTimersByTimeAsync(2_000);
    } finally {
      vi.useRealTimers();
    }
    await settle();
    expect(group()?.textContent).toContain('Another stamp');
  });

  it('still reads the stamp again when the window is already on the Swarm ID site and refuses to drop its opener', async () => {
    chatOnMyBeeNode();
    const appsWindow = {
      closed: false,
      set opener(_value: unknown) {
        throw new DOMException('Blocked a frame from accessing a cross-origin frame.', 'SecurityError');
      },
    };
    vi.spyOn(window, 'open').mockReturnValue(appsWindow as unknown as Window);
    const swarmId = await openConnect();
    click(radio('My stamp')!);
    await settle();

    vi.useFakeTimers();
    try {
      expect(() => click(button('Change stamp in Swarm ID'))).not.toThrow();
      swarmId.client().postageBatch = { ...BATCH, label: 'Picked again' };
      appsWindow.closed = true;
      await vi.advanceTimersByTimeAsync(2_000);
    } finally {
      vi.useRealTimers();
    }
    await settle();
    expect(group()?.textContent).toContain('Picked again');
  });

  it('says a stamp that ran out has run out', async () => {
    chatOnMyBeeNode();
    await openConnect({ ...BATCH, utilization: 1 });
    click(radio('My stamp')!);
    await settle();

    expect(group()?.textContent).toContain('ran out');
  });
});
