import type { SocialLink } from '@/design/themes';

import './SocialLinks.scss';

/**
 * A row of icon links. Each icon is drawn as a mask, so it takes the link's colour whatever colours its
 * file uses. The url is quoted because a small icon is inlined as a data URL whose quotes and spaces
 * break a bare url().
 */
export function SocialLinks({ links, variant = 'plain' }: { links: SocialLink[]; variant?: 'plain' | 'tiles' }) {
  return (
    <ul className={`social-links social-links--${variant}`}>
      {links.map((link) => (
        <li key={link.href}>
          <a className="social-link" href={link.href} target="_blank" rel="noreferrer" aria-label={link.label}>
            <span
              className="social-link-icon"
              style={{ maskImage: `url("${link.iconUrl}")`, WebkitMaskImage: `url("${link.iconUrl}")` }}
              aria-hidden="true"
            />
          </a>
        </li>
      ))}
    </ul>
  );
}
