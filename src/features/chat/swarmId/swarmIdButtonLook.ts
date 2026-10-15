import type { SwarmIdButtonConfig } from './swarmIdClient';

export const SWARM_ID_BUTTON_FULL = 'full';
export const SWARM_ID_BUTTON_COMPACT = 'compact';

/** A page-sized button, or the smaller one Connect draws in a row beside other words. */
export type SwarmIdButtonSize = typeof SWARM_ID_BUTTON_FULL | typeof SWARM_ID_BUTTON_COMPACT;

/**
 * The look of the page's primary button (`Button.scss`) in the theme the page wears now, as values Swarm ID's frame can
 * take, since the page's stylesheet does not reach into it. A value the page does not define is left to the frame.
 */
export function swarmIdButtonLook(
  size: SwarmIdButtonSize,
  root: HTMLElement = document.documentElement,
): SwarmIdButtonConfig {
  const style = root.ownerDocument.defaultView?.getComputedStyle(root);
  const read = (name: string) => style?.getPropertyValue(name).trim() || undefined;
  const look: SwarmIdButtonConfig = {
    backgroundColor: read('--color-primary'),
    color: read('--color-on-primary'),
    borderRadius: read('--radius-md'),
    fontFamily: read('--font-family-base'),
    fontSize: read(size === SWARM_ID_BUTTON_COMPACT ? '--font-size-sm' : '--font-size-base'),
    fontWeight: read('--font-weight-bold'),
  };
  return Object.fromEntries(Object.entries(look).filter(([, value]) => value !== undefined));
}
