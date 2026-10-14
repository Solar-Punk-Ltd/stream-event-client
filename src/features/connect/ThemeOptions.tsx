import { type KeyboardEvent, useRef } from 'react';

import { useThemeChoice } from '@/app/ThemeChoiceProvider';
import { THEME_LABELS, THEME_NAMES, type ThemeName } from '@/design/themeNames';

/** How far each key moves the pick, as a radio group moves it: the arrows step and wrap, Home and End jump. */
const STEP_KEYS: Record<string, (index: number, count: number) => number> = {
  ArrowDown: (index, count) => (index + 1) % count,
  ArrowRight: (index, count) => (index + 1) % count,
  ArrowUp: (index, count) => (index - 1 + count) % count,
  ArrowLeft: (index, count) => (index - 1 + count) % count,
  Home: () => 0,
  End: (_, count) => count - 1,
};

/**
 * The theme switcher under the viewer's ID in Connect: one radio per theme, named, and a tick on the worn one. One Tab
 * stop for the group, the checked option, and the arrows move the pick.
 */
export function ThemeOptions() {
  const { look, chooseLook } = useThemeChoice();
  const options = useRef<Partial<Record<ThemeName, HTMLButtonElement | null>>>({});

  const step = (event: KeyboardEvent<HTMLDivElement>) => {
    const move = STEP_KEYS[event.key];
    if (!move) {
      return;
    }
    event.preventDefault();
    const next = THEME_NAMES[move(THEME_NAMES.indexOf(look), THEME_NAMES.length)];
    chooseLook(next);
    options.current[next]?.focus();
  };

  return (
    <div role="radiogroup" aria-label="Theme" className="connect-theme" onKeyDown={step}>
      <p className="connect-theme-heading" aria-hidden="true">
        Theme
      </p>
      {THEME_NAMES.map((name) => (
        <button
          key={name}
          ref={(button) => {
            options.current[name] = button;
          }}
          type="button"
          role="radio"
          aria-checked={look === name}
          tabIndex={look === name ? 0 : -1}
          className="connect-theme-option"
          onClick={() => chooseLook(name)}
        >
          {THEME_LABELS[name]}
          {look === name && (
            <span className="connect-theme-check" aria-hidden="true">
              ✓
            </span>
          )}
        </button>
      ))}
    </div>
  );
}
