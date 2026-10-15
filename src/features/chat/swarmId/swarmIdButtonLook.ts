import { ButtonVariant } from '@/shared/components/Button/Button';

import { swarmIdButtonFontFaces } from './swarmIdButtonFonts';
import type { SwarmIdButtonConfig } from './swarmIdClient';

export const SWARM_ID_BUTTON_FULL = 'full';
export const SWARM_ID_BUTTON_COMPACT = 'compact';

/** A page-sized button, or the smaller one Connect draws in a row beside other words. */
export type SwarmIdButtonSize = typeof SWARM_ID_BUTTON_FULL | typeof SWARM_ID_BUTTON_COMPACT;

/** The theme variables each of the page's button variants is painted with, as `Button.scss` paints them. */
const VARIANT_VARIABLES: Record<ButtonVariant, { background: string; label: string; weight: string }> = {
  [ButtonVariant.PRIMARY]: {
    background: '--color-primary',
    label: '--color-on-primary',
    weight: '--font-weight-bold',
  },
  [ButtonVariant.SECONDARY]: {
    background: '--color-button-secondary',
    label: '--color-text',
    weight: '--font-weight-semibold',
  },
};

/**
 * The look of one of the page's buttons in the theme the page wears now, as values Swarm ID's frame can take, since the
 * page's stylesheet does not reach into it: its colours, radius, typeface, size and weight, and the page's own font
 * file for that typeface and weight. A value the page does not define is left to the frame.
 */
export function swarmIdButtonLook(
  variant: ButtonVariant,
  size: SwarmIdButtonSize,
  root: HTMLElement = document.documentElement,
): SwarmIdButtonConfig {
  const style = root.ownerDocument.defaultView?.getComputedStyle(root);
  const read = (name: string) => style?.getPropertyValue(name).trim() || undefined;
  const { background, label, weight } = VARIANT_VARIABLES[variant];
  const fontFamily = read('--font-family-base');
  const fontWeight = read(weight);
  const fontFaces = swarmIdButtonFontFaces(fontFamily, fontWeight, root.ownerDocument.baseURI);
  const look: SwarmIdButtonConfig = {
    backgroundColor: read(background),
    color: read(label),
    borderRadius: read('--radius-md'),
    fontFamily,
    fontSize: read(size === SWARM_ID_BUTTON_COMPACT ? '--font-size-sm' : '--font-size-base'),
    fontWeight,
    fontFaces: fontFaces.length > 0 ? fontFaces : undefined,
  };
  return Object.fromEntries(Object.entries(look).filter(([, value]) => value !== undefined));
}
