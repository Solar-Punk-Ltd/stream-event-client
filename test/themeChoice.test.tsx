// @vitest-environment jsdom
import { createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { loadThemeChoice, saveThemeChoice, THEME_CHOICE_STORAGE_KEY, wornLook } from '../src/app/themeChoice';
import { type BrowserStorage } from '../src/app/browserStorage';
import { THEME_LABELS, THEME_NAMES } from '../src/design/themeNames';
import { nicknameLogin } from '../src/features/chat/auth/login';
import { persistUserSession } from '../src/features/chat/auth/persistence';
import { LoginButton } from '../src/features/chat/LoginButton/LoginButton';
import { ChatUserProvider } from '../src/features/chat/User';
import { button, click, dialog, mount, queryButton, type Mounted } from './helpers/dom';
import { minimalConfig, withThemeChoice } from './helpers/themeChoice';

const REFUSING: BrowserStorage = {
  getItem: () => {
    throw new Error('refused');
  },
  setItem: () => {
    throw new Error('refused');
  },
  removeItem: () => {
    throw new Error('refused');
  },
};

let mounted: Mounted | null = null;

function header(config = minimalConfig()) {
  mounted = mount(withThemeChoice(createElement(ChatUserProvider, null, createElement(LoginButton)), config));
}

/** A theme's option by the name a screen reader hears, which leaves out the swatch and the tick. */
function themeOption(name: (typeof THEME_NAMES)[number]): HTMLButtonElement | null {
  const spoken = (option: Element) => {
    const copy = option.cloneNode(true) as Element;
    copy.querySelectorAll('[aria-hidden="true"]').forEach((hidden) => hidden.remove());
    return copy.textContent?.trim();
  };
  return (
    [...document.querySelectorAll<HTMLButtonElement>('[role="radio"]')].find(
      (option) => spoken(option) === THEME_LABELS[name],
    ) ?? null
  );
}

beforeEach(() => {
  localStorage.clear();
  delete document.documentElement.dataset.theme;
});

afterEach(() => {
  mounted?.unmount();
  mounted = null;
  document.body.innerHTML = '';
});

describe('the look a viewer picked', () => {
  it('is read back from this browser', () => {
    saveThemeChoice('web3privacy');

    expect(loadThemeChoice()).toBe('web3privacy');
  });

  it('is forgotten when the build no longer carries it', () => {
    localStorage.setItem(THEME_CHOICE_STORAGE_KEY, 'retired-theme');

    expect(loadThemeChoice()).toBeNull();
  });

  it('holds for the visit when the browser refuses its storage', () => {
    expect(() => saveThemeChoice('web3privacy', REFUSING)).not.toThrow();
    expect(loadThemeChoice(REFUSING)).toBeNull();
  });

  it("is worn over the deployment's theme, and the deployment's theme without one", () => {
    const config = minimalConfig({ theme: 'swarm' });

    expect(wornLook(config, 'web3privacy')).toBe('web3privacy');
    expect(wornLook(config, null)).toBe('swarm');
  });

  it('is not worn on a deployment that has the switcher off', () => {
    const config = minimalConfig({ theme: 'web3privacy', themeSwitcher: false });

    expect(wornLook(config, 'swarm')).toBe('web3privacy');
  });
});

describe('the theme switcher in the header', () => {
  it('is not offered before the viewer logs in', () => {
    header();

    expect(queryButton('Join chat')).toBeTruthy();
    for (const name of THEME_NAMES) {
      expect(themeOption(name)).toBeNull();
    }
  });

  it("offers every theme in the name's menu, the worn one checked", () => {
    persistUserSession(nicknameLogin('Ada'));
    header(minimalConfig({ theme: 'swarm' }));
    click(button(/^Ada/));

    expect(document.querySelector('[role="radiogroup"]')?.getAttribute('aria-label')).toBe('Theme');
    expect(themeOption('swarm')?.getAttribute('aria-checked')).toBe('true');
    expect(themeOption('web3privacy')?.getAttribute('aria-checked')).toBe('false');
  });

  it('dresses the page in the picked theme and keeps the pick for the next visit', () => {
    persistUserSession(nicknameLogin('Ada'));
    header(minimalConfig({ theme: 'swarm' }));
    click(button(/^Ada/));
    click(themeOption('web3privacy') as HTMLButtonElement);

    expect(document.documentElement.dataset.theme).toBe('web3privacy');
    expect(themeOption('web3privacy')?.getAttribute('aria-checked')).toBe('true');
    expect(loadThemeChoice()).toBe('web3privacy');
  });

  it('keeps the pick after a logout', () => {
    persistUserSession(nicknameLogin('Ada'));
    header(minimalConfig({ theme: 'swarm' }));
    click(button(/^Ada/));
    click(themeOption('web3privacy') as HTMLButtonElement);
    click(button('Log out'));
    const confirm = [...(dialog()?.querySelectorAll('button') ?? [])].find((node) => node.textContent === 'Log out');
    click(confirm as HTMLButtonElement);

    expect(queryButton('Join chat')).toBeTruthy();
    expect(document.documentElement.dataset.theme).toBe('web3privacy');
    expect(loadThemeChoice()).toBe('web3privacy');
  });

  it('wears the kept pick when the page opens again', () => {
    saveThemeChoice('web3privacy');
    header(minimalConfig({ theme: 'swarm' }));

    expect(document.documentElement.dataset.theme).toBe('web3privacy');
  });

  it('is left out of the menu on a deployment that has the switcher off', () => {
    persistUserSession(nicknameLogin('Ada'));
    header(minimalConfig({ themeSwitcher: false }));
    click(button(/^Ada/));

    expect(queryButton('Log out')).toBeTruthy();
    for (const name of THEME_NAMES) {
      expect(themeOption(name)).toBeNull();
    }
  });
});
