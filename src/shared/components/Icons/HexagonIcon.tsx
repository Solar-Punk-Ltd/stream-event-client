import React from 'react';

/** A hexagon, the shape Swarm draws a node as. */
export const HexagonIcon: React.FC = () => (
  <svg
    width="20"
    height="20"
    viewBox="0 0 20 20"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
    aria-hidden="true"
  >
    <path d="M10 2.25 16.75 6.1v7.8L10 17.75 3.25 13.9V6.1L10 2.25Z" strokeLinejoin="round" />
    <circle cx="10" cy="10" r="2.25" />
  </svg>
);
