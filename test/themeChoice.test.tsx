// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { loadThemeChoice, saveThemeChoice, THEME_CHOICE_STORAGE_KEY, wornLook } from '../src/app/themeChoice';
import { type BrowserStorage } from '../src/app/browserStorage';
import { THEME_LABELS, THEME_NAMES } from '../src/design/themeNames';
import { nicknameLogin } from '../src/features/chat/auth/login';
import { persistUserSession } from '../src/features/chat/auth/persistence';
import { chatConfig, connectPage } from './helpers/connectPage';
import { button, click, press, queryButton, settle, type Mounted } from './helpers/dom';
import { minimalConfig } from './helpers/themeChoice';

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

const realFetch = globalThis.fetch;

async function header(config = chatConfig()) {
  mounted = connectPage({ config });
  await settle();
}

/** A theme's option by the name a screen reader hears, which leaves out the tick. */
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
  globalThis.fetch = (async () => new Response('', { status: 404 })) as typeof fetch;
});

afterEach(() => {
  mounted?.unmount();
  mounted = null;
  globalThis.fetch = realFetch;
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

describe('the theme switcher in Connect', () => {
  it('is not offered before the viewer joins the chat', async () => {
    await header();
    click(button('Connect'));

    expect(queryButton('Chat as guest')).toBeTruthy();
    for (const name of THEME_NAMES) {
      expect(themeOption(name)).toBeNull();
    }
  });

  it('offers every theme under the ID, the worn one checked', async () => {
    persistUserSession(nicknameLogin('Ada'));
    await header(chatConfig({ theme: 'swarm' }));
    click(button(/^Ada/));

    expect(document.querySelector('[role="radiogroup"]')?.getAttribute('aria-label')).toBe('Theme');
    expect(themeOption('swarm')?.getAttribute('aria-checked')).toBe('true');
    expect(themeOption('web3privacy')?.getAttribute('aria-checked')).toBe('false');
  });

  it('dresses the page in the picked theme and keeps the pick for the next visit', async () => {
    persistUserSession(nicknameLogin('Ada'));
    await header(chatConfig({ theme: 'swarm' }));
    click(button(/^Ada/));
    click(themeOption('web3privacy') as HTMLButtonElement);

    expect(document.documentElement.dataset.theme).toBe('web3privacy');
    expect(themeOption('web3privacy')?.getAttribute('aria-checked')).toBe('true');
    expect(loadThemeChoice()).toBe('web3privacy');
  });

  it('keeps the pick after the guest leaves', async () => {
    persistUserSession(nicknameLogin('Ada'));
    await header(chatConfig({ theme: 'swarm' }));
    click(button(/^Ada/));
    click(themeOption('web3privacy') as HTMLButtonElement);
    click(button('Leave'));
    click(button('Leave'));
    await settle();

    expect(queryButton('Chat as guest')).toBeTruthy();
    expect(document.documentElement.dataset.theme).toBe('web3privacy');
    expect(loadThemeChoice()).toBe('web3privacy');
  });

  it('wears the kept pick when the page opens again', async () => {
    saveThemeChoice('web3privacy');
    await header(chatConfig({ theme: 'swarm' }));

    expect(document.documentElement.dataset.theme).toBe('web3privacy');
  });

  it('is left out of Connect on a deployment that has the switcher off', async () => {
    persistUserSession(nicknameLogin('Ada'));
    await header(chatConfig({ themeSwitcher: false }));
    click(button(/^Ada/));

    expect(queryButton('Leave')).toBeTruthy();
    for (const name of THEME_NAMES) {
      expect(themeOption(name)).toBeNull();
    }
  });

  it('does not wear a kept pick on a deployment that has the switcher off', async () => {
    saveThemeChoice('swarm');
    await header(chatConfig({ theme: 'web3privacy', themeSwitcher: false }));

    expect(document.documentElement.dataset.theme).toBe('web3privacy');
    expect(loadThemeChoice()).toBe('swarm');
  });
});

describe('the theme switcher from the keyboard', () => {
  it('is one Tab stop, the checked option', async () => {
    persistUserSession(nicknameLogin('Ada'));
    await header(chatConfig({ theme: 'swarm' }));
    click(button(/^Ada/));

    expect(themeOption('swarm')?.tabIndex).toBe(0);
    expect(themeOption('web3privacy')?.tabIndex).toBe(-1);
  });

  it('moves the pick and the focus with the arrows, wrapping at the ends', async () => {
    persistUserSession(nicknameLogin('Ada'));
    await header(chatConfig({ theme: 'swarm' }));
    click(button(/^Ada/));

    press(themeOption('swarm') as HTMLButtonElement, 'ArrowDown');
    expect(document.documentElement.dataset.theme).toBe('web3privacy');
    expect(document.activeElement).toBe(themeOption('web3privacy'));
    expect(themeOption('web3privacy')?.tabIndex).toBe(0);

    press(themeOption('web3privacy') as HTMLButtonElement, 'ArrowDown');
    expect(document.documentElement.dataset.theme).toBe('swarm');
    expect(document.activeElement).toBe(themeOption('swarm'));

    press(themeOption('swarm') as HTMLButtonElement, 'End');
    expect(document.documentElement.dataset.theme).toBe(THEME_NAMES[THEME_NAMES.length - 1]);
    expect(loadThemeChoice()).toBe(THEME_NAMES[THEME_NAMES.length - 1]);
  });
});
