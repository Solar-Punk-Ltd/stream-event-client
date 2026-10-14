import React from 'react';

/** An outline hexagon, for a chat guest told apart only by a key their browser keeps. */
export const GuestBadgeIcon: React.FC = () => (
  <svg className="sender-badge-guest" width="15" height="15" viewBox="0 0 16 16" aria-hidden="true">
    <path d="M8 1.2 13.9 4.6v6.8L8 14.8 2.1 11.4V4.6Z" fill="none" strokeWidth="1.6" />
  </svg>
);
