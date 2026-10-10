import { createElement, type ReactNode } from 'react';

import { ThemeChoiceProvider } from '../../src/app/ThemeChoiceProvider';
import { parseRuntimeConfig, type RuntimeConfig } from '../../src/config/runtimeConfig';

/** The smallest config the page accepts, with whatever a test adds on top. */
export function minimalConfig(extra: Record<string, unknown> = {}): RuntimeConfig {
  const result = parseRuntimeConfig({
    gatewayUrl: '/bee',
    catalog: { owner: '0x' + '1'.repeat(40), topic: 'event-streams' },
    ...extra,
  });
  if (!result.ok) {
    throw new Error(result.problem);
  }
  return result.config;
}

/** Wraps a header or a page in the theme switcher's provider, as the app does. */
export function withThemeChoice(node: ReactNode, config: RuntimeConfig = minimalConfig()): ReactNode {
  return createElement(ThemeChoiceProvider, { config }, node);
}
