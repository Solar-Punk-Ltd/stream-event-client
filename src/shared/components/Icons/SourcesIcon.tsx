import React from 'react';

/** Three stacked layers, the mark of the Sources screen: where each part of the page is read from. */
export const SourcesIcon: React.FC = () => (
  <svg
    width="16"
    height="16"
    viewBox="0 0 16 16"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
    aria-hidden="true"
  >
    <path d="M8 1.75 14.25 5 8 8.25 1.75 5 8 1.75Z" strokeLinejoin="round" />
    <path d="m1.75 8 6.25 3.25L14.25 8" strokeLinecap="round" strokeLinejoin="round" />
    <path d="m1.75 11 6.25 3.25L14.25 11" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);
