import React from 'react';

/** A browser window with a node inside it, for the Swarm node that runs in this tab. */
export const BrowserIcon: React.FC = () => (
  <svg
    width="20"
    height="20"
    viewBox="0 0 20 20"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
    aria-hidden="true"
  >
    <rect x="2.75" y="3.75" width="14.5" height="12.5" rx="1.5" />
    <path d="M2.75 7.25h14.5" />
    <path d="M10 9.25 12.6 10.75v3L10 15.25l-2.6-1.5v-3L10 9.25Z" strokeLinejoin="round" />
  </svg>
);
