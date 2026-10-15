// The Latin files only, because the button's labels are the design's English words.
import archivo600 from '@fontsource/archivo/files/archivo-latin-600-normal.woff2?url';
import archivo700 from '@fontsource/archivo/files/archivo-latin-700-normal.woff2?url';
import geist600 from '@fontsource/geist/files/geist-latin-600-normal.woff2?url';
import geist700 from '@fontsource/geist/files/geist-latin-700-normal.woff2?url';

import type { SwarmIdButtonFontFace } from './swarmIdClient';

/**
 * The files this build bundles for each theme's typeface, at the two weights Swarm ID's button is drawn in: the
 * secondary button's semibold and the primary's bold. The bundler names each by its content, and these are the same
 * files the stylesheet serves.
 */
const BUTTON_FONT_FILES: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  Geist: { '600': geist600, '700': geist700 },
  Archivo: { '600': archivo600, '700': archivo700 },
};

/** Swarm ID's frame takes a font file over https, or over plain http only from this machine. */
const LOOPBACK_HOSTS = ['localhost', '127.0.0.1', '[::1]'];

function isServedToTheFrame(url: URL): boolean {
  return url.protocol === 'https:' || (url.protocol === 'http:' && LOOPBACK_HOSTS.includes(url.hostname));
}

/** The first family of a CSS font-family list, without its quotes. */
function firstFamily(fontFamily: string): string {
  return (fontFamily.split(',')[0] ?? '').trim().replace(/^["']|["']$/g, '');
}

/**
 * The page's own font file for the typeface and weight Swarm ID's button is drawn in, absolute on the page's origin,
 * for the frame to load itself. None for a typeface or weight the build bundles no file for, and none on a page served
 * over plain http beyond this machine, since the frame would refuse the button whole for such an address.
 */
export function swarmIdButtonFontFaces(
  fontFamily: string | undefined,
  fontWeight: string | undefined,
  pageUrl: string = document.baseURI,
): SwarmIdButtonFontFace[] {
  if (!fontFamily || !fontWeight) {
    return [];
  }
  const family = firstFamily(fontFamily);
  const file = BUTTON_FONT_FILES[family]?.[fontWeight];
  if (!file) {
    return [];
  }
  const url = new URL(file, pageUrl);
  return isServedToTheFrame(url) ? [{ family, url: url.href, weight: fontWeight }] : [];
}
