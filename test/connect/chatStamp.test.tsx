// @vitest-environment jsdom
// @vitest-environment-options {"url":"https://example.com/"}
import { MessageVia } from '@solarpunkltd/swarm-chat-js';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { saveAddedSources, saveRouting } from '../../src/app/sourceStorage';
import { nicknameLogin } from '../../src/features/chat/auth/login';
import { persistUserSession } from '../../src/features/chat/auth/persistence';
import { loadChatStampChoice, saveChatStampChoice } from '../../src/features/chat/stamp/chatStampChoice';
import { OWN_FEED_COPY } from '../../src/features/connect/connectWords';
import { EVENT_GATEWAY_STAMPS_ITSELF, PICK_A_SOURCE_THAT_SENDS } from '../../src/features/chat/stamp/ownStampRoute';
import type { SwarmIdPostageBatch } from '../../src/features/chat/swarmId/swarmIdClient';
import { chooseSource, defaultRouting } from '../../src/swarm/routing';
import { connectPage, seen } from '../helpers/connectPage';
import { button, click, dialog, settle, type Mounted, waitFor } from '../helpers/dom';
import { fakeSwarmId, SIGNED_IN } from '../helpers/fakeSwarmId';
import { addressOf, BOUND_SITE, chatKeyFor } from '../helpers/signedChat';
import { wearThemeCss } from '../helpers/themeCss';

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
    });
    const box = group()?.textContent ?? '';
    expect(box).toContain('Event chat');
    expect(box).toContain('40 days left');
    expect(box).toContain('42% used');
    expect(group()?.querySelector('[role="progressbar"]')?.getAttribute('aria-valuenow')).toBe('42');
    expect(radio('My stamp')?.closest('label')?.textContent).toContain('go out through your own Bee node');
  });

  it('offers my stamp with Weeb3 picked for the chat history, which sends the message itself', async () => {
    saveAddedSources([{ id: 'added-1', type: 'weeb-3', name: 'Weeb3', url: '' }]);
    saveRouting(chooseSource(defaultRouting('event'), 'added-1'));
    await openConnect();

    expect(radio('My stamp')?.disabled).toBe(false);
    click(radio('My stamp')!);
    await settle();

    expect(seen.chatStamp?.route).toEqual({ ok: true, through: 'weeb-3' });
    expect(seen.chatStamp?.sending).toEqual({ via: MessageVia.OWN_STAMP, url: null });
    expect(seen.chatStamp?.warning).toBeNull();
    const line = radio('My stamp')?.closest('label')?.textContent ?? '';
    expect(line).toContain('go out through Weeb3, the Swarm node in this browser');
    expect(line).not.toContain('Bee node');
  });

  it('starts another account on this browser on the gateway, whatever an earlier account picked', async () => {
    chatOnMyBeeNode();
    saveChatStampChoice('c'.repeat(40), { payWith: MessageVia.OWN_STAMP });
    await openConnect();

    expect(radio('Gateway pays')?.checked).toBe(true);
    expect(seen.chatStamp?.sending).toEqual({ via: MessageVia.GATEWAY });
  });

  it('keeps what the account picked across a reload', async () => {
    chatOnMyBeeNode();
    saveChatStampChoice(signedInAddress, { payWith: MessageVia.OWN_STAMP });
    await openConnect();

    expect(radio('My stamp')?.checked).toBe(true);
  });

  it('copies every message on my stamp to my own feed, with no setting to turn it off, and says so', async () => {
    chatOnMyBeeNode();
    await openConnect();
    expect(group()?.textContent, 'no own feed while the gateway pays').not.toContain(OWN_FEED_COPY);

    click(radio('My stamp')!);
    await settle();

    expect(group()?.querySelector('input[type="checkbox"]'), 'nothing to switch off').toBeNull();
    expect(group()?.textContent).toContain(OWN_FEED_COPY);
    expect(loadChatStampChoice(signedInAddress)).toEqual({ payWith: MessageVia.OWN_STAMP });
  });

  it("says when Swarm ID has given this site no stamp, and offers to choose one there with Swarm ID's button", async () => {
    chatOnMyBeeNode();
    const swarmId = await openConnect(null);
    click(radio('My stamp')!);
    await settle();

    expect(group()?.textContent).toContain('Swarm ID has given this site no stamp yet.');
    expect(button('Choose a stamp in Swarm ID')).toBe(swarmId.client().shownButton().element);
    expect(swarmId.client().shownButton().action).toBe('change-stamp');
  });

  it("opens the Swarm ID window again from Swarm ID's button while signed in, and shows the stamp picked there at once", async () => {
    wearThemeCss();
    chatOnMyBeeNode();
    const opened = vi.spyOn(window, 'open');
    const swarmId = await openConnect();
    click(radio('My stamp')!);
    await settle();

    click(button('Change stamp in Swarm ID'));
    await settle();
    expect(swarmId.client().shownButton().action).toBe('change-stamp');
    expect(swarmId.client().shownButton().config, "the page's secondary button, as it was").toMatchObject({
      backgroundColor: 'rgba(250,250,250,0.1)',
      fontWeight: '600',
    });
    expect(swarmId.client().windowsOpened).toBe(1);
    expect(swarmId.client().connectCalls, 'the page opens no window of its own').toBe(0);
    expect(opened, 'the library opens its own window, never the Apps screen').not.toHaveBeenCalled();

    swarmId.client().pickStamp({ ...BATCH, label: 'Another stamp', utilization: 0.1 });
    await settle();
    await settle();
    const box = group()?.textContent ?? '';
    expect(box).toContain('Another stamp');
    expect(box).toContain('10% used');
    expect(seen.chatUser?.swarmIdSession, 'still signed in').toBeTruthy();
  });

  it('chooses a stamp in the same window for a site with none, which clears the warning and relabels the button in place', async () => {
    chatOnMyBeeNode();
    const swarmId = await openConnect(null);
    click(radio('My stamp')!);
    await settle();
    expect(seen.chatStamp?.warning?.title).toBe('No stamp for this site.');

    click(button('Choose a stamp in Swarm ID'));
    await settle();
    swarmId.client().pickStamp(BATCH);
    await settle();
    await settle();

    expect(swarmId.client().windowsOpened).toBe(1);
    expect(group()?.textContent).toContain('Event chat');
    expect(seen.chatStamp?.warning).toBeNull();
    const shown = swarmId.client().shownButton();
    expect(shown.element.textContent).toBe('Change stamp in Swarm ID');
    expect(swarmId.client().buttons, 'one button, relabelled rather than mounted again').toEqual([shown]);
  });

  it('says when the browser blocked that window, and that the button opens it once pop-ups are allowed', async () => {
    chatOnMyBeeNode();
    const swarmId = await openConnect();
    click(radio('My stamp')!);
    await settle();
    swarmId.client().nextWindow = 'blocked';

    click(button('Change stamp in Swarm ID'));
    expect(group()?.textContent).toContain('Your browser blocked the Swarm ID window.');
    expect(group()?.textContent).toContain('Allow pop-ups for this site, then press the button again.');
    expect(seen.chatUser?.swarmIdSession, 'a blocked window signs nobody out').toBeTruthy();

    window.dispatchEvent(new Event('focus'));
    await settle();
    expect(group()?.textContent, 'a focus only reads the stamp again').toContain(
      'Your browser blocked the Swarm ID window.',
    );

    swarmId.client().nextWindow = 'opens';
    click(button('Change stamp in Swarm ID'));
    expect(swarmId.client().windowsOpened).toBe(1);
    expect(group()?.textContent).not.toContain('Your browser blocked the Swarm ID window.');
  });

  it('reads the figures again on a report only when the stamp Swarm ID names for this site changed', async () => {
    chatOnMyBeeNode();
    const swarmId = await openConnect();
    click(radio('My stamp')!);
    await settle();
    const readsBefore = swarmId.client().postageBatchReads;

    swarmId.client().pickStamp(BATCH);
    await settle();
    expect(swarmId.client().postageBatchReads, 'the same stamp reported again').toBe(readsBefore);

    swarmId.client().pickStamp({ ...BATCH, label: 'Another stamp' });
    await settle();
    await settle();
    expect(swarmId.client().postageBatchReads).toBe(readsBefore + 1);
    expect(group()?.textContent).toContain('Another stamp');
  });

  it('reads the figures again on the next report after a read Swarm ID did not answer', async () => {
    chatOnMyBeeNode();
    const swarmId = await openConnect();
    click(radio('My stamp')!);
    await settle();
    swarmId.client().postageBatchFailsOnce = true;
    window.dispatchEvent(new Event('focus'));
    await settle();
    await settle();
    expect(group()?.textContent).toContain('Swarm ID did not say how your stamp stands.');

    swarmId.client().pickStamp(BATCH);
    await settle();
    await settle();
    expect(group()?.textContent, 'the same stamp reported again after a failed read').toContain('Event chat');
  });

  it('shows a sign-in Swarm ID gave no stamp yet as having none, without a read', async () => {
    chatOnMyBeeNode();
    saveChatStampChoice(signedInAddress, { payWith: MessageVia.OWN_STAMP });
    const swarmId = await fakeSwarmId(SIGNED_IN, (client) => {
      client.postageBatchHangs = true;
    });
    mounted = connectPage({ swarmId });
    await waitFor(() => seen.chatUser?.swarmIdSession);
    click(button(/^Ida/));
    await settle();

    expect(group()?.textContent).toContain(
      'Swarm ID has given this site no stamp yet. Choose one and confirm it in the Swarm ID window.',
    );
    expect(swarmId.client().postageBatchReads).toBe(0);
  });

  it('shows no stamp at once when Swarm ID reports none, without waiting for a read', async () => {
    chatOnMyBeeNode();
    const swarmId = await openConnect();
    click(radio('My stamp')!);
    await settle();
    expect(group()?.textContent).toContain('Event chat');
    swarmId.client().postageBatchHangs = true;

    swarmId.client().pickStamp(undefined);
    await settle();

    expect(group()?.textContent).toContain('Swarm ID has given this site no stamp yet.');
    expect(seen.chatStamp?.warning?.title).toBe('No stamp for this site.');
  });

  it('still reads the figures again when the page comes back into focus', async () => {
    chatOnMyBeeNode();
    const swarmId = await openConnect();
    click(radio('My stamp')!);
    await settle();
    const readsBefore = swarmId.client().postageBatchReads;

    window.dispatchEvent(new Event('focus'));
    await settle();

    expect(swarmId.client().postageBatchReads).toBe(readsBefore + 1);
  });

  it('says a stamp that ran out has run out', async () => {
    chatOnMyBeeNode();
    await openConnect({ ...BATCH, utilization: 1 });
    click(radio('My stamp')!);
    await settle();

    expect(group()?.textContent).toContain('ran out');
  });
});
