// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { nicknameLogin } from '../../src/features/chat/auth/login';
import { persistUserSession } from '../../src/features/chat/auth/persistence';
import {
  button,
  click,
  dialog,
  doubleClick,
  type Mounted,
  press,
  queryButton,
  settle,
  text,
  type,
  waitFor,
} from '../helpers/dom';
import { chatConfig, connectPage, seen } from '../helpers/connectPage';
import { minimalConfig } from '../helpers/themeChoice';

const CATALOG_OWNER = '1'.repeat(40);
const STREAM_OWNER = 'e'.repeat(40);
const SEGMENT = 'ab'.repeat(32);
const LIST = JSON.stringify([
  { owner: STREAM_OWNER, topic: 'main-stage', title: 'Main stage', timestamp: 1, mediatype: 'video', state: 'vod' },
]);
const PLAYLIST = `#EXTM3U\n#EXT-X-TARGETDURATION:2\n#EXTINF:2.0,\n${SEGMENT}\n#EXT-X-ENDLIST\n`;
const GATEWAY = 'https://gw.example.org';

const realFetch = globalThis.fetch;
/** Hosts that answer but do not let this page read the answer, as a node without this site in its CORS list. */
let refusingHosts: string[];
let mounted: Mounted | null = null;

/** A Bee node serving this event, and a refusal for every request to a host in {@link refusingHosts}. */
function answering(input: RequestInfo | URL, init?: RequestInit): Response {
  const url = new URL(String(input), 'http://localhost');
  if (refusingHosts.includes(url.origin)) {
    if (init?.mode === 'no-cors') {
      return new Response(null);
    }
    throw new TypeError('Failed to fetch');
  }
  const path = url.pathname;
  if (path.endsWith('/health')) {
    return Response.json({ status: 'ok', version: '2.8.2', apiVersion: '7.3.0' });
  }
  if (path.endsWith('/readiness')) {
    return Response.json({ status: 'ready' });
  }
  if (path.endsWith('/peers')) {
    return Response.json({ peers: [{ address: 'cd'.repeat(32) }] });
  }
  if (path.includes('/feeds/') && path.includes(CATALOG_OWNER)) {
    return new Response(LIST, { headers: { 'swarm-feed-index': '0000000000000000' } });
  }
  if (path.includes('/feeds/')) {
    return new Response(PLAYLIST);
  }
  return new Response(new Uint8Array([1, 2, 3]));
}

async function openConnect(config = chatConfig()) {
  mounted = connectPage({ config });
  await settle();
  click(button(/^(My Swarm|Ada)/));
  await settle();
}

const section = (name: string) => dialog()?.querySelector(`section[aria-label="${name}"]`) ?? null;

beforeEach(() => {
  localStorage.clear();
  refusingHosts = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => answering(input, init)) as typeof fetch;
});

afterEach(() => {
  mounted?.unmount();
  mounted = null;
  globalThis.fetch = realFetch;
  document.body.innerHTML = '';
});

describe("the header's connect button", () => {
  it('says My Swarm while the viewer is not chatting, and on a site with no chat', async () => {
    mounted = connectPage({ config: minimalConfig() });
    await settle();

    expect(button('My Swarm').getAttribute('aria-haspopup')).toBe('dialog');
  });

  it("shows the guest's name with its badge once chatting", async () => {
    persistUserSession(nicknameLogin('Ada'));
    mounted = connectPage();
    await settle();

    expect(button(/^Ada/).querySelector('svg')?.getAttribute('class')).toBe('sender-badge-guest');
  });
});

describe('My Swarm', () => {
  it('holds the ID, Swarm access and Use for, in that order, and no chat stamp yet', async () => {
    await openConnect();

    expect([...(dialog()?.querySelectorAll('section') ?? [])].map((part) => part.getAttribute('aria-label'))).toEqual([
      'ID',
      'Swarm access',
      'Use for',
    ]);
    expect(dialog()?.querySelector('h2')?.textContent).toBe('My Swarm');
  });

  it('has no ID on a site with no chat', async () => {
    await openConnect(minimalConfig());

    expect(section('ID')).toBeNull();
    expect(section('Swarm access')).not.toBeNull();
  });

  it('lists every source in one list, the offered ones badged, with kind and address, and its settings', async () => {
    await openConnect();
    const rows = [...(section('Swarm access')?.querySelectorAll('[data-source-row]') ?? [])];

    expect(rows.map((row) => row.querySelector('.connect-row-name')?.textContent)).toEqual([
      'Event gateway',
      'Backup gateway',
    ]);
    expect(rows[0].textContent).toContain('Offered');
    expect(rows[0].textContent).toContain('Gateway · https://event.example.com');
    expect(button('Settings of Event gateway')).toBeTruthy();
  });

  it('closes on its close button and goes back to its menu the next time', async () => {
    await openConnect();
    click(button('Add source'));
    click(button('Close My Swarm'));
    expect(dialog()).toBeNull();

    click(button('My Swarm'));
    expect(dialog()?.querySelector('h2')?.textContent).toBe('My Swarm');
  });
});

describe("My Swarm's views", () => {
  it('go back one view on Escape, and only Escape on the menu closes My Swarm', async () => {
    await openConnect();
    click(button('Add source'));
    click(button(/^Gateway/));
    expect(dialog()?.querySelector('h2')?.textContent).toBe('Add a gateway');

    press(document.body, 'Escape');
    expect(dialog()?.querySelector('h2')?.textContent).toBe('Add source');
    press(document.body, 'Escape');
    expect(dialog()?.querySelector('h2')?.textContent).toBe('My Swarm');
    press(document.body, 'Escape');
    expect(dialog()).toBeNull();
  });

  it('take focus to the new view, its first field where it has one and its title otherwise', async () => {
    await openConnect();
    click(button('Add source'));
    await settle();
    expect(document.activeElement?.textContent).toBe('Add source');

    click(button(/^Gateway/));
    await settle();
    expect(document.activeElement).toBe(dialog()?.querySelector('input'));

    click(button('Back'));
    await settle();
    expect(document.activeElement?.textContent).toBe('Add source');
  });
});

describe('adding a source', () => {
  it('offers a gateway, a Bee node of your own and Weeb3, each with its line', async () => {
    await openConnect();
    click(button('Add source'));

    expect(text()).toContain('A Swarm gateway at an https address');
    expect(text()).toContain('On this computer or at an https address');
    expect(text()).toContain('A Swarm node in this browser tab');
  });

  it('keeps Add disabled until every check passed, and adds nothing before', async () => {
    await openConnect();
    click(button('Add source'));
    click(button(/^Gateway/));

    expect(button('Add gateway').disabled).toBe(true);
    type(addressField(), GATEWAY);
    click(button('Test connection'));
    await waitFor(() => (button('Add gateway').disabled ? null : true));

    expect([...document.querySelectorAll('[data-check]')].map((line) => line.getAttribute('data-state'))).toEqual([
      'passed',
      'passed',
      'passed',
      'passed',
      'passed',
      'passed',
    ]);
    expect(seen.app!.sources).toHaveLength(2);
  });

  it('adds a gateway once, however fast Add is clicked twice', async () => {
    await openConnect();
    click(button('Add source'));
    click(button(/^Gateway/));
    type(addressField(), GATEWAY);
    click(button('Test connection'));
    await waitFor(() => (button('Add gateway').disabled ? null : true));
    doubleClick(button('Add gateway'));
    await settle();

    expect(seen.app!.sources.filter(({ url }) => url === GATEWAY)).toHaveLength(1);
  });

  it("adds a gateway that passed, back on My Swarm's menu, without putting it in use", async () => {
    await openConnect();
    click(button('Add source'));
    click(button(/^Gateway/));
    type(addressField(), GATEWAY);
    click(button('Test connection'));
    await waitFor(() => (button('Add gateway').disabled ? null : true));
    click(button('Add gateway'));
    await settle();

    expect(seen.app!.sources.at(-1)).toMatchObject({
      type: 'gateway',
      name: 'My gateway',
      url: GATEWAY,
      offered: false,
    });
    expect(seen.app!.parts.player).toBe('event');
    expect(dialog()?.querySelector('h2')?.textContent).toBe('My Swarm');
  });

  it('stops at the first check that fails, says what to fix, and adds nothing', async () => {
    refusingHosts = [GATEWAY];
    await openConnect();
    click(button('Add source'));
    click(button(/^Gateway/));
    type(addressField(), GATEWAY);
    click(button('Test connection'));
    await waitFor(() => document.querySelector('.connect-warn'));

    expect([...document.querySelectorAll('[data-check]')].map((line) => line.getAttribute('data-state'))).toEqual([
      'passed',
      'failed',
      'skipped',
      'skipped',
      'skipped',
      'skipped',
    ]);
    expect(document.querySelector('.connect-warn')?.textContent).toContain(
      "Not added. It does not allow this site (CORS).Its operator has to add this site to Bee's cors-allowed-origins.",
    );
    expect(button('Add gateway').disabled).toBe(true);
  });

  it('asks for the checks again once the address changes after they passed', async () => {
    await openConnect();
    click(button('Add source'));
    click(button(/^Gateway/));
    type(addressField(), GATEWAY);
    click(button('Test connection'));
    await waitFor(() => (button('Add gateway').disabled ? null : true));

    type(addressField(), 'https://other.example.org');
    expect(button('Add gateway').disabled).toBe(true);
  });

  it('offers one Bee node of your own, its tile saying so once added', async () => {
    await openConnect();
    click(button('Add source'));
    click(button(/^My Bee node/));
    expect(addressField().value).toBe('http://localhost:1633');
    click(button('Test connection'));
    await waitFor(() => (button('Add node').disabled ? null : true));
    click(button('Add node'));
    await settle();
    click(button('Add source'));

    expect(button(/^My Bee node/).disabled).toBe(true);
    expect(button(/^My Bee node/).textContent).toContain('Already added');
  });
});

function addressField(): HTMLInputElement {
  const label = [...document.querySelectorAll('label')].find((candidate) => candidate.textContent === 'Address');
  return document.getElementById(label?.htmlFor ?? '') as HTMLInputElement;
}

describe("a source's settings", () => {
  it('are read only for a source the event offers, which cannot be removed', async () => {
    await openConnect();
    click(button('Settings of Event gateway'));

    expect(text()).toContain('Offered by this event. It cannot be changed or removed.');
    expect([...(dialog()?.querySelectorAll('input') ?? [])].every((field) => field.disabled)).toBe(true);
    expect(queryButton('Remove')).toBeNull();
  });

  it('run the same checks again on asking', async () => {
    await openConnect();
    click(button('Settings of Backup gateway'));
    click(button('Test connection'));
    await waitFor(() =>
      [...document.querySelectorAll('[data-check]')].every((line) => line.getAttribute('data-state') === 'passed')
        ? true
        : null,
    );

    expect(document.querySelectorAll('[data-check]')).toHaveLength(6);
  });

  it('remove an added source, moving every part that read from it to the event gateway', async () => {
    await openConnect();
    const id = seen.app!.addSource({ type: 'gateway', name: 'Mine', url: GATEWAY });
    await settle();
    seen.app!.setRouting({
      mode: 'per-part',
      source: 'event',
      parts: { player: id, 'stream-list': 'backup', previews: id, chat: id },
    });
    await settle();
    click(button('Settings of Mine'));
    click(button('Remove'));
    await settle();

    expect(seen.app!.parts).toEqual({ player: 'event', 'stream-list': 'backup', previews: 'event', chat: 'event' });
    expect(seen.app!.sources.map(({ id: kept }) => kept)).not.toContain(id);
  });
});

describe('use for', () => {
  it('reads every part from the source picked for all features, the chat history included', async () => {
    await openConnect();
    const select = section('Use for')!.querySelector('select')!;
    expect([...select.options].map((option) => option.textContent)).toEqual(['Event gateway', 'Backup gateway']);

    select.value = 'backup';
    select.dispatchEvent(new Event('change', { bubbles: true }));
    await settle();

    expect(seen.app!.parts).toEqual({ player: 'backup', 'stream-list': 'backup', previews: 'backup', chat: 'backup' });
  });

  it('per feature, picks the video, the stream list, the previews and the chat history apart', async () => {
    await openConnect();
    click(button('Per feature'));
    await settle();

    const labels = [...section('Use for')!.querySelectorAll('label')].map((label) => label.textContent);
    expect(labels).toEqual(['Video', 'Stream list', 'Previews', 'Chat history']);
    expect(text()).not.toContain('Event chat service');
    expect(text()).not.toContain('Same as video');
  });

  it('offers the node in this browser for every part and for all features', async () => {
    await openConnect();
    seen.app!.addSource({ type: 'weeb-3', name: '', url: '' });
    await settle();
    const [all] = [...section('Use for')!.querySelectorAll('select')];
    expect([...all.options].find((option) => option.textContent === 'Weeb3')?.disabled).toBe(false);
    click(button('Per feature'));
    await settle();

    for (const select of section('Use for')!.querySelectorAll('select')) {
      const node = [...select.options].find((option) => option.value.startsWith('added-'));
      expect(node?.textContent).toBe('Weeb3');
      expect(node?.disabled).toBe(false);
    }
  });
});

describe('leaving the chat as a guest', () => {
  it('asks first, and forgets the name once confirmed', async () => {
    persistUserSession(nicknameLogin('Ada'));
    await openConnect();
    click(button('Leave'));
    expect(dialog()?.querySelector('h2')?.textContent).toBe('Leave the chat as a guest?');
    click(button('Leave'));
    await settle();

    expect(seen.chatUser!.session).toBeNull();
    expect(dialog()?.querySelector('h2')?.textContent).toBe('My Swarm');
  });
});
