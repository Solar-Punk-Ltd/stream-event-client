import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useState } from 'react';

import { type RuntimeConfig, themeSwitcherEnabled } from '@/config/runtimeConfig';
import { applyLook } from '@/design/look';
import { type ThemeName } from '@/design/themeNames';

import { loadThemeChoice, saveThemeChoice, wornLook } from './themeChoice';

interface ThemeChoice {
  /** The theme whose colours and typefaces the page wears. */
  look: ThemeName;
  /** Whether this deployment lets a viewer switch the look at all. */
  canSwitch: boolean;
  chooseLook: (name: ThemeName) => void;
}

const ThemeChoiceContext = createContext<ThemeChoice | null>(null);

export function ThemeChoiceProvider({ config, children }: { config: RuntimeConfig; children: ReactNode }) {
  const canSwitch = themeSwitcherEnabled(config);
  const [look, setLook] = useState<ThemeName>(() => wornLook(config, loadThemeChoice()));

  useEffect(() => {
    applyLook(look);
  }, [look]);

  const chooseLook = useCallback(
    (name: ThemeName) => {
      if (!canSwitch) {
        return;
      }
      saveThemeChoice(name);
      setLook(name);
    },
    [canSwitch],
  );

  const value = useMemo(() => ({ look, canSwitch, chooseLook }), [look, canSwitch, chooseLook]);

  return <ThemeChoiceContext.Provider value={value}>{children}</ThemeChoiceContext.Provider>;
}

export function useThemeChoice(): ThemeChoice {
  const choice = useContext(ThemeChoiceContext);
  if (!choice) {
    throw new Error('useThemeChoice must be used within a ThemeChoiceProvider');
  }
  return choice;
}
