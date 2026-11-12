import { shownLinks } from '@/features/catalog/streamLinks';

import './StreamLinks.scss';

/** The other places a stream can be watched, one outlined link each, under the call to watch it here. */
export function StreamLinks({ links }: { links: unknown }) {
  const shown = shownLinks(links);
  if (shown.length === 0) {
    return null;
  }

  return (
    <ul className="stream-links">
      {shown.map(({ label, href }) => (
        <li key={`${label} ${href}`}>
          <a className="stream-link" href={href} target="_blank" rel="noreferrer">
            {label} →
          </a>
        </li>
      ))}
    </ul>
  );
}
