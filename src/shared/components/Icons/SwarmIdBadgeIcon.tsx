import React from 'react';

import './BadgeIcons.scss';

/** The Swarm hexagon filled, with a check: Swarm ID confirmed the chat address belongs to the account. */
export const SwarmIdBadgeIcon: React.FC = () => (
  <svg className="sender-badge-swarm-id" width="15" height="15" viewBox="0 0 16 16" aria-hidden="true">
    <path className="sender-badge-hexagon" d="M8 1.2 13.9 4.6v6.8L8 14.8 2.1 11.4V4.6Z" strokeWidth="1.6" />
    <path
      className="sender-badge-check"
      d="M5.3 8.1 7.2 10l3.5-3.7"
      fill="none"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);
