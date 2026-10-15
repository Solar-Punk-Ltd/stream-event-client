// @vitest-environment jsdom
// @vitest-environment-options {"url":"https://example.com/"}
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { compile } from 'sass';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { nicknameLogin } from '../../src/features/chat/auth/login';
import { persistUserSession } from '../../src/features/chat/auth/persistence';
import { connectPage } from '../helpers/connectPage';
import { button, click, type Mounted, settle } from '../helpers/dom';
import { type FakeSwarmId, fakeSwarmId } from '../helpers/fakeSwarmId';

const SRC = join(dirname(dirname(dirname(fileURLToPath(import.meta.url)))), 'src');

/** The page's own design, so the button reads the same variables a browser would give it. */
const themeCss = compile(join(SRC, 'design', 'theme.scss'), {
  importers: [{ findFileUrl: (url) => (url.startsWith('@/') ? pathToFileURL(join(SRC, url.slice(2))) : null) }],
}).css;

let mounted: Mounted | null = null;
const realFetch = globalThis.fetch;

beforeAll(() => {
  const style = document.createElement('style');
  style.textContent = themeCss;
  document.head.appendChild(style);
});

beforeEach(() => {
  localStorage.clear();
  delete document.documentElement.dataset.theme;
  globalThis.fetch = (async () => new Response('', { status: 404 })) as typeof fetch;
  persistUserSession(nicknameLogin('Ada'));
});

afterEach(() => {
  mounted?.unmount();
  mounted = null;
  globalThis.fetch = realFetch;
  document.body.innerHTML = '';
});

async function guestMenu(): Promise<FakeSwarmId> {
  const swarmId = await fakeSwarmId();
  mounted = connectPage({ swarmId });
  await settle();
  await settle();
  click(button(/^Ada/));
  return swarmId;
}

describe("Swarm ID's button wears the viewer's look", () => {
  it("is drawn as the page's primary button in the Swarm theme, in the design's words", async () => {
    const swarmId = await guestMenu();

    expect(swarmId.client().shownButton().config).toEqual({
      text: 'Sign in with Swarm ID',
      backgroundColor: '#f47a20',
      color: '#151517',
      borderRadius: '12px',
      fontFamily: expect.stringMatching(/^"Geist",\s*system-ui/),
      fontSize: '13px',
      fontWeight: '700',
    });
  });

  it('takes the Web3Privacy look in place when the viewer switches theme, without mounting it again', async () => {
    const swarmId = await guestMenu();

    click(button('Web3Privacy'));
    await settle();

    const shown = swarmId.client().shownButton();
    expect(swarmId.client().buttons).toHaveLength(1);
    expect(shown.config).toMatchObject({
      text: 'Sign in with Swarm ID',
      backgroundColor: '#70ff88',
      color: '#122014',
      fontFamily: expect.stringMatching(/^"Archivo",\s*system-ui/),
    });

    click(button('Swarm'));
    await settle();
    expect(swarmId.client().buttons).toHaveLength(1);
    expect(shown.config).toMatchObject({ backgroundColor: '#f47a20', color: '#151517' });
  });
});
