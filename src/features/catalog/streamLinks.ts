/** A place a broadcast can also be watched, or a page that goes with it, as the admin layer writes it. */
export interface StreamLink {
  label: string;
  href: string;
}

/** As many as the admin layer lets a stream carry. More than that is not something a card has room for. */
const MAX_LINKS = 4;

function isHttps(href: string): boolean {
  try {
    return new URL(href).protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * The links of an entry that are fit to show. The catalog is JSON off a feed, so `links` is read as
 * unknown: anything that is not a list is no links, and an item without a label or with an address
 * that is not https is left out, which keeps a `javascript:` address off the page.
 */
export function shownLinks(links: unknown): StreamLink[] {
  if (!Array.isArray(links)) {
    return [];
  }
  const shown: StreamLink[] = [];
  for (const link of links) {
    if (typeof link !== 'object' || link === null) continue;
    const { label, href } = link as { label?: unknown; href?: unknown };
    if (typeof label !== 'string' || typeof href !== 'string') continue;
    if (label.trim() === '' || !isHttps(href.trim())) continue;
    shown.push({ label: label.trim(), href: href.trim() });
    if (shown.length === MAX_LINKS) break;
  }
  return shown;
}
