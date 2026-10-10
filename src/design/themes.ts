import swarmLogoUrl from './assets/swarm-logo.svg';
import blueskyIconUrl from './assets/social/bluesky.svg';
import githubIconUrl from './assets/social/github.svg';
import instagramIconUrl from './assets/social/instagram.svg';
import linkedinIconUrl from './assets/social/linkedin.svg';
import telegramIconUrl from './assets/social/telegram.svg';
import xIconUrl from './assets/social/x.svg';
import youtubeIconUrl from './assets/social/youtube.svg';
import web3privacyCongressLogoUrl from './assets/web3privacy-congress-logo.png';
import web3privacyFaviconUrl from './assets/web3privacy-favicon.svg';
import web3privacyHeroUrl from './assets/web3privacy-hero.webp';
import web3privacyLogoUrl from './assets/web3privacy-logo.png';
import { type ThemeName } from './themeNames';

export { DEFAULT_THEME, THEME_LABELS, THEME_NAMES, type ThemeName } from './themeNames';

export interface FooterLink {
  label: string;
  href: string;
}

/** A link shown as an icon alone, its label read out instead. */
export interface SocialLink extends FooterLink {
  iconUrl: string;
}

export interface FooterColumn {
  /** Left out by a footer whose columns are plain lists. */
  title?: string;
  links: FooterLink[];
}

/** The footer under the browse page: the brand block, the link columns and the bottom row. */
export interface FooterSettings {
  /** The brand block's words and links under the logo. A footer that leads with its logo alone leaves them out. */
  tagline?: string;
  brandLinks?: FooterLink[];
  columns: FooterColumn[];
  /** Who the bottom row names, followed by the year. */
  owner: string;
  /** Said in the bottom row instead of the owner and the year, for a brand that words its own. */
  bottomText?: string;
  bottomLinks: FooterLink[];
  /** A row of icon links beside the columns, under a heading, in place of the newsletter's column. */
  social?: { heading: string; links: SocialLink[] };
}

/**
 * A deployment's words and images, chosen with its `theme` in config.json: the logo, the hero, the footer
 * and the tab. They stay the deployment's when a viewer switches the look, which changes only the
 * colours and typefaces.
 */
export interface ThemeContent {
  logoUrl: string;
  /** What the logo says, for a reader who cannot see it. */
  logoAlt: string;
  /** The tab's title and icon, for a theme that is not the page's built-in Swarm ones. */
  pageTitle?: string;
  faviconUrl?: string;
  heroTitle: string;
  /** The event's logo shown in place of the title's words, which stay as its text for a screen reader. */
  heroTitleImageUrl?: string;
  heroSubtitle: string;
  /** Optional lines for an event page: a label over the title, the date, a tagline and a paragraph. */
  heroEyebrow?: string;
  heroDate?: string;
  heroTagline?: string;
  heroBody?: string;
  /** A photo behind the hero, under a dark overlay, as web3privacy.info shows its own. */
  heroImageUrl?: string;
  /** One call to action under the title. */
  heroCta?: FooterLink;
  /** Show the footer's icon row in the hero as well, as tiles. */
  heroSocial?: boolean;
  footer: FooterSettings;
}

// The links of the footer msrs-client shows in its Swarm theme, which mirrors the Swarm Foundation's own.
const SWARM_FOOTER: FooterSettings = {
  tagline: 'Swarm is a decentralised storage and communication system for a sovereign digital society.',
  brandLinks: [
    { label: 'ethswarm.org', href: 'https://www.ethswarm.org' },
    { label: 'Documentation', href: 'https://docs.ethswarm.org' },
    { label: 'Blog', href: 'https://blog.ethswarm.org' },
  ],
  columns: [
    {
      title: 'Community',
      links: [
        { label: 'Discord', href: 'https://discord.com/invite/hyCr9BMX9U' },
        { label: 'X (Twitter)', href: 'https://x.com/ethswarm' },
        { label: 'Reddit', href: 'https://www.reddit.com/r/ethswarm/' },
        { label: 'YouTube', href: 'https://www.youtube.com/@EthereumSwarm' },
      ],
    },
    {
      title: 'Development',
      links: [
        { label: 'GitHub', href: 'https://github.com/ethersphere' },
        { label: 'Developer Hub', href: 'https://docs.ethswarm.org/docs/develop/introduction/' },
        { label: 'Research Papers', href: 'https://papers.ethswarm.org/' },
        { label: 'Beeport', href: 'https://beeport.ethswarm.org/' },
      ],
    },
    {
      title: 'Resources',
      links: [
        { label: 'Swarm Hub', href: 'https://links.ethswarm.org/' },
        { label: 'Desktop App', href: 'https://desktop.ethswarm.org/' },
        { label: 'Swarmy', href: 'https://swarmy.cloud/' },
        { label: 'Etherjot', href: 'https://etherjot.eth.limo/' },
      ],
    },
  ],
  owner: 'Swarm Foundation',
  bottomLinks: [
    { label: 'Privacy policy', href: 'https://www.ethswarm.org/privacy' },
    { label: 'Hosted on Swarm', href: 'https://swarm.bzz.link/' },
  ],
};

// web3privacy.info's own footer, its words, links and icons, with Swarm credited in the bottom row.
const WEB3PRIVACY_FOOTER: FooterSettings = {
  columns: [
    {
      links: [
        { label: 'Manifesto', href: 'https://docs.web3privacy.info/about-us/manifesto/' },
        { label: 'How to get involved', href: 'https://docs.web3privacy.info/get-involved/index' },
        { label: 'Grants / Support Us', href: 'https://web3privacy.info/donate' },
      ],
    },
    {
      links: [
        { label: 'Events', href: 'https://web3privacy.info/events' },
        { label: 'Articles', href: 'https://paragraph.com/@web3privacy-now' },
        { label: 'Talks', href: 'https://www.youtube.com/@Web3PrivacyNow' },
      ],
    },
  ],
  social: {
    heading: 'Join our privacy movement on:',
    links: [
      { label: 'X', href: 'https://x.com/web3privacy', iconUrl: xIconUrl },
      { label: 'Telegram', href: 'https://t.me/+QOj6126xlEs0OTQ0', iconUrl: telegramIconUrl },
      { label: 'YouTube', href: 'https://www.youtube.com/@Web3PrivacyNow', iconUrl: youtubeIconUrl },
      { label: 'Bluesky', href: 'https://bsky.app/profile/web3privacy.info', iconUrl: blueskyIconUrl },
      { label: 'GitHub', href: 'https://github.com/web3privacy', iconUrl: githubIconUrl },
      { label: 'LinkedIn', href: 'https://www.linkedin.com/company/web3privacynow', iconUrl: linkedinIconUrl },
      { label: 'Instagram', href: 'https://www.instagram.com/web3privacy_now/', iconUrl: instagramIconUrl },
    ],
  },
  owner: 'Web3PrivacyNow',
  bottomText: 'Copyleft 2026 – Code AGPLv3+ · Content CC BY-SA 4.0 · Web3PrivacyNow',
  bottomLinks: [{ label: 'Hosted on Swarm', href: 'https://swarm.bzz.link/' }],
};

export const THEME_CONTENT: Record<ThemeName, ThemeContent> = {
  swarm: {
    logoUrl: swarmLogoUrl,
    logoAlt: 'Swarm',
    heroTitle: 'Devcon 8 streams',
    heroSubtitle: 'Live talks and recordings from Devcon 8, stored and delivered over the Swarm network.',
    footer: SWARM_FOOTER,
  },
  web3privacy: {
    logoUrl: web3privacyLogoUrl,
    logoAlt: 'Web3Privacy Now',
    pageTitle: 'Cypherpunk Congress 3 · Livestream',
    // web3privacy.info's own icon: the bar of the logo on a black tile.
    faviconUrl: web3privacyFaviconUrl,
    heroEyebrow: 'Livestream',
    heroTitle: 'Cypherpunk Congress 3 · Mumbai 2026',
    // The congress's own logo, white on a transparent ground (from Web3Privacy's banner).
    heroTitleImageUrl: web3privacyCongressLogoUrl,
    heroSubtitle: "The world's largest cypherpunk and human rights event",
    heroDate: 'Nov 2, 9am (IST)',
    heroTagline: 'Privacy loves equality',
    heroBody:
      '5000 people are gathering in Mumbai to celebrate privacy and internet freedoms in dialogue with Global South. Past editions featured visionaries like Richard Stallman, Chelsea Manning, Vitalik Buterin, Roger Dingledine, Eva Galperin, Renata Avila, David Chaum, Juan Benet & many others.',
    // web3privacy.info's own hero photo (content CC BY-SA 4.0, Web3PrivacyNow).
    heroImageUrl: web3privacyHeroUrl,
    heroCta: { label: 'About Cypherpunk Congress', href: 'https://congress.web3privacy.info' },
    heroSocial: true,
    footer: WEB3PRIVACY_FOOTER,
  },
};

/**
 * Gives the tab the deployment's own title and icon when its theme has them. `index.html` carries the
 * Swarm ones, so a theme without them leaves the tab as it is. Applied once, because a viewer who
 * switches the look keeps the deployment's words.
 */
export function applyThemeContent(name: ThemeName, doc: Document = document): void {
  const { pageTitle, faviconUrl } = THEME_CONTENT[name];
  if (pageTitle) {
    doc.title = pageTitle;
  }
  if (faviconUrl) {
    let icon = doc.querySelector<HTMLLinkElement>('link[rel~="icon"]');
    if (!icon) {
      icon = doc.createElement('link');
      icon.rel = 'icon';
      doc.head.append(icon);
    }
    icon.type = 'image/svg+xml';
    icon.href = faviconUrl;
  }
}
