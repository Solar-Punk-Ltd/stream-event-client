import xIconUrl from '@/design/assets/social/x.svg';
import youtubeIconUrl from '@/design/assets/social/youtube.svg';
import { shownLinks } from '@/features/catalog/streamLinks';
import { LinkIcon } from '@/shared/components/LinkIcon/LinkIcon';

import './StreamLinks.scss';

const HOST_ICONS: Record<string, string> = {
  'x.com': xIconUrl,
  'twitter.com': xIconUrl,
  'youtube.com': youtubeIconUrl,
  'youtu.be': youtubeIconUrl,
};

/** The icon of the site a link opens, for the sites the page has one of, whatever the link is labelled. */
function iconFor(href: string): string | null {
  const host = new URL(href).hostname.replace(/^(www|m)\./, '');
  return HOST_ICONS[host] ?? null;
}

/** The other places a stream can be watched, one outlined link each, under the call to watch it here. */
export function StreamLinks({ links }: { links: unknown }) {
  const shown = shownLinks(links);
  if (shown.length === 0) {
    return null;
  }

  return (
    <ul className="stream-links">
      {shown.map(({ label, href }) => {
        const icon = iconFor(href);
        return (
          <li key={`${label} ${href}`}>
            <a className="stream-link" href={href} target="_blank" rel="noreferrer">
              {icon && <LinkIcon url={icon} />}
              {label} →
            </a>
          </li>
        );
      })}
    </ul>
  );
}
