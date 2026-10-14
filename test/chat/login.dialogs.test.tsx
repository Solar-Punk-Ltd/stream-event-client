// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { nicknameLogin } from '../../src/features/chat/auth/login';
import { persistUserSession, restoreUserSession } from '../../src/features/chat/auth/persistence';
import { connectPage } from '../helpers/connectPage';
import { button, click, dialog, input, press, queryButton, settle, text, type, type Mounted } from '../helpers/dom';
import { minimalConfig } from '../helpers/themeChoice';

let mounted: Mounted | null = null;
const realFetch = globalThis.fetch;

async function header() {
  mounted = connectPage();
  await settle();
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

describe('joining the chat from Connect', () => {
  it('offers to chat as a guest with just a name', async () => {
    await header();
    click(button('Connect'));

    expect(dialog()?.getAttribute('aria-modal')).toBe('true');
    expect(dialog()?.textContent).toContain('Chat as a guest with just a name.');
    expect(input('Your name')).toBeTruthy();
  });

  it('closes Connect on Escape without joining', async () => {
    await header();
    click(button('Connect'));
    press(document.body, 'Escape');

    expect(dialog()).toBeNull();
    expect(restoreUserSession()).toBeNull();
  });

  it('chats under the trimmed name, keeps it for the next visit, and shows it in the header and in Connect', async () => {
    await header();
    click(button('Connect'));
    type(input('Your name'), '  Ada  ');
    click(button('Chat as guest'));
    await settle();

    expect(restoreUserSession()?.username).toBe('Ada');
    expect(queryButton(/^Ada/)).toBeTruthy();
    expect(dialog()?.textContent).toContain('Guest');
    expect(queryButton('Leave')).toBeTruthy();
  });

  it('chats on Enter', async () => {
    await header();
    click(button('Connect'));
    type(input('Your name'), 'Ada');
    press(input('Your name'), 'Enter');

    expect(restoreUserSession()?.username).toBe('Ada');
  });

  it('says what a name must be, and keeps the form, for an empty or too long name', async () => {
    await header();
    click(button('Connect'));
    for (const name of ['', '   ', 'x'.repeat(21)]) {
      type(input('Your name'), name);
      click(button('Chat as guest'));
      expect(dialog()?.textContent).toContain('1 to 20 characters');
      expect(restoreUserSession()).toBeNull();
    }
  });
});

describe('a guest leaving', () => {
  beforeEach(() => {
    persistUserSession(nicknameLogin('Ada'));
  });

  it('asks before leaving, and keeps the name on Cancel', async () => {
    await header();
    click(button(/^Ada/));
    click(button('Leave'));
    expect(dialog()?.textContent).toContain('your display name');
    click(button('Cancel'));

    expect(restoreUserSession()?.username).toBe('Ada');
    expect(dialog()?.querySelector('h2')?.textContent).toBe('Connect');
  });

  it('leaves once confirmed, forgetting the name', async () => {
    await header();
    click(button(/^Ada/));
    click(button('Leave'));
    click(button('Leave'));
    await settle();

    expect(restoreUserSession()).toBeNull();
    expect(text()).toContain('Chat as a guest with just a name.');
  });
});

describe('a site with no chat', () => {
  it('offers no way into the chat in Connect', async () => {
    mounted = connectPage({ config: minimalConfig() });
    await settle();
    click(button('Connect'));

    expect(text()).not.toContain('Chat as a guest');
  });
});
