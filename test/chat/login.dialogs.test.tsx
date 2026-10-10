// @vitest-environment jsdom
import { createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { nicknameLogin } from '../../src/features/chat/auth/login';
import { persistUserSession, restoreUserSession } from '../../src/features/chat/auth/persistence';
import { LoginButton } from '../../src/features/chat/LoginButton/LoginButton';
import { ChatUserProvider } from '../../src/features/chat/User';
import { button, click, dialog, input, mount, press, queryButton, text, type, type Mounted } from '../helpers/dom';
import { withThemeChoice } from '../helpers/themeChoice';

let mounted: Mounted | null = null;

function header() {
  mounted = mount(withThemeChoice(createElement(ChatUserProvider, null, createElement(LoginButton))));
}

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  mounted?.unmount();
  mounted = null;
  document.body.innerHTML = '';
});

describe('the header when signed out', () => {
  it('offers to join the chat, which asks for a display name', () => {
    header();
    click(button('Join chat'));
    expect(dialog()?.getAttribute('aria-modal')).toBe('true');
    expect(dialog()?.textContent).toContain('Join the chat');
    expect(document.activeElement).toBe(input('Display name'));
  });

  it('closes the dialog on Cancel without signing in', () => {
    header();
    click(button('Join chat'));
    click(button('Cancel'));
    expect(dialog()).toBeNull();
    expect(restoreUserSession()).toBeNull();
    expect(queryButton('Join chat')).toBeTruthy();
  });

  it('signs in with the trimmed name, keeps it for the next visit, and shows it', () => {
    header();
    click(button('Join chat'));
    type(input('Display name'), '  Ada  ');
    click(button('Join'));
    expect(dialog()).toBeNull();
    expect(restoreUserSession()?.username).toBe('Ada');
    expect(queryButton(/^Ada/)).toBeTruthy();
  });

  it('signs in on Enter', () => {
    header();
    click(button('Join chat'));
    type(input('Display name'), 'Ada');
    press(input('Display name'), 'Enter');
    expect(restoreUserSession()?.username).toBe('Ada');
  });

  it('says what a name must be, and keeps the dialog open, for an empty or too long name', () => {
    header();
    click(button('Join chat'));
    for (const name of ['', '   ', 'x'.repeat(21)]) {
      type(input('Display name'), name);
      click(button('Join'));
      expect(dialog()?.textContent).toContain('1 to 20 characters');
      expect(restoreUserSession()).toBeNull();
    }
  });
});

describe('the header when signed in', () => {
  beforeEach(() => {
    persistUserSession(nicknameLogin('Ada'));
  });

  it('shows the name, with a menu that offers to log out', () => {
    header();
    const name = button(/^Ada/);
    expect(name.getAttribute('aria-expanded')).toBe('false');
    click(name);
    expect(name.getAttribute('aria-expanded')).toBe('true');
    expect(queryButton('Log out')).toBeTruthy();
  });

  it('closes the menu on Escape', () => {
    header();
    click(button(/^Ada/));
    press(document.body, 'Escape');
    expect(queryButton('Log out')).toBeNull();
  });

  it('asks before logging out, and keeps the name on Cancel', () => {
    header();
    click(button(/^Ada/));
    click(button('Log out'));
    expect(dialog()?.textContent).toContain('your display name');
    click(button('Cancel'));
    expect(dialog()).toBeNull();
    expect(restoreUserSession()?.username).toBe('Ada');
  });

  it('logs out once confirmed, forgetting the name', () => {
    header();
    click(button(/^Ada/));
    click(button('Log out'));
    const confirm = [...(dialog()?.querySelectorAll('button') ?? [])].find((node) => node.textContent === 'Log out');
    click(confirm as HTMLButtonElement);
    expect(dialog()).toBeNull();
    expect(restoreUserSession()).toBeNull();
    expect(text()).toContain('Join chat');
  });
});
