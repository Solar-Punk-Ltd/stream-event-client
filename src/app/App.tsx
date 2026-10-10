import { StrictMode } from 'react';
import ReactDOM from 'react-dom/client';
import { HashRouter } from 'react-router';

import { loadRuntimeConfig, selectedTheme } from '@/config/runtimeConfig';
import { applyLook, applyThemeContent } from '@/design';
import { ChatUserProvider } from '@/features/chat/User';

import { AppContextProvider as AppProvider } from './AppProvider';
import { ConfigProblem } from './ConfigProblem';
import BaseRouter from './routes';
import { loadThemeChoice, wornLook } from './themeChoice';
import { ThemeChoiceProvider } from './ThemeChoiceProvider';

import '@/design';

const root = ReactDOM.createRoot(document.getElementById('root') as HTMLElement);

// A viewer's own pick is worn while the config loads, so a returning viewer does not see the default
// look first. The config can still overrule it, on a deployment that has the switcher off.
const themeChoice = loadThemeChoice();
if (themeChoice) {
  applyLook(themeChoice);
}

void loadRuntimeConfig().then((result) => {
  if (result.ok) {
    applyThemeContent(selectedTheme(result.config));
    applyLook(wornLook(result.config, themeChoice));
  }
  root.render(
    <StrictMode>
      {result.ok ? (
        <AppProvider config={result.config}>
          <ThemeChoiceProvider config={result.config}>
            <ChatUserProvider>
              <HashRouter>
                <BaseRouter />
              </HashRouter>
            </ChatUserProvider>
          </ThemeChoiceProvider>
        </AppProvider>
      ) : (
        <ConfigProblem result={result} />
      )}
    </StrictMode>,
  );
});
