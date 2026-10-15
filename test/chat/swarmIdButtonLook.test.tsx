// @vitest-environment jsdom
// @vitest-environment-options {"url":"https://example.com/"}
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { nicknameLogin } from '../../src/features/chat/auth/login';
import { persistUserSession } from '../../src/features/chat/auth/persistence';
import { connectPage } from '../helpers/connectPage';
import { button, click, type Mounted, settle } from '../helpers/dom';
import { type FakeSwarmId, fakeSwarmId } from '../helpers/fakeSwarmId';
import { wearThemeCss } from '../helpers/themeCss';

let mounted: Mounted | null = null;
const realFetch = globalThis.fetch;

beforeAll(wearThemeCss);

beforeEach(() => {
  localStorage.clear();
  delete document.documentElement.dataset.theme;
  globalThis.fetch = (async () => new Response('', { status: 404 })) as typeof fetch;
});

afterEach(() => {
  mounted?.unmount();
  mounted = null;
  globalThis.fetch = realFetch;
  document.body.innerHTML = '';
});

/** A Geist or Archivo file of the build, as the page serves it, absolute on the page's own origin. */
const fontFile = (name: string) => expect.stringMatching(new RegExp(`^https://example\\.com/.*${name}[^/]*\\.woff2$`));

async function header(asGuest: boolean): Promise<FakeSwarmId> {
  if (asGuest) {
    persistUserSession(nicknameLogin('Ada'));
  }
  const swarmId = await fakeSwarmId();
  mounted = connectPage({ swarmId });
  await settle();
  await settle();
  click(button(asGuest ? /^Ada/ : 'Connect'));
  return swarmId;
}

describe("Swarm ID's button wears the viewer's look", () => {
  it("is the page's primary button in Connect, in the Swarm theme's colours and its own Geist, in the design's words", async () => {
    const swarmId = await header(false);

    expect(swarmId.client().shownButton().config).toEqual({
      text: 'Sign in with Swarm ID',
      ariaLabel: 'Sign in with Swarm ID',
      backgroundColor: '#f47a20',
      color: '#151517',
      borderRadius: '12px',
      fontFamily: expect.stringMatching(/^"Geist",\s*system-ui/),
      fontSize: '14px',
      fontWeight: '700',
      fontFaces: [{ family: 'Geist', url: fontFile('geist-latin-700-normal'), weight: '700' }],
    });
  });

  it("is the page's secondary button beside a guest's name, as it was before it became Swarm ID's", async () => {
    const swarmId = await header(true);

    expect(swarmId.client().shownButton().config).toEqual({
      text: 'Sign in with Swarm ID',
      ariaLabel: 'Sign in with Swarm ID',
      backgroundColor: 'rgba(250,250,250,0.1)',
      color: '#fafafa',
      borderRadius: '12px',
      fontFamily: expect.stringMatching(/^"Geist",\s*system-ui/),
      fontSize: '13px',
      fontWeight: '600',
      fontFaces: [{ family: 'Geist', url: fontFile('geist-latin-600-normal'), weight: '600' }],
    });
  });

  it('takes the Web3Privacy look and its Archivo in place when the viewer switches theme, without mounting it again', async () => {
    const swarmId = await header(true);

    click(button('Web3Privacy'));
    await settle();

    const shown = swarmId.client().shownButton();
    expect(swarmId.client().buttons).toHaveLength(1);
    expect(shown.config).toMatchObject({
      text: 'Sign in with Swarm ID',
      color: '#ffffff',
      fontFamily: expect.stringMatching(/^"Archivo",\s*system-ui/),
      fontFaces: [{ family: 'Archivo', url: fontFile('archivo-latin-600-normal'), weight: '600' }],
    });

    click(button('Swarm'));
    await settle();
    expect(swarmId.client().buttons).toHaveLength(1);
    expect(shown.config).toMatchObject({ color: '#fafafa', fontFaces: [{ family: 'Geist' }] });
  });
});
