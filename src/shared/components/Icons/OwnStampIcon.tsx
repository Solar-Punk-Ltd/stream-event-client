import React from 'react';

/** A postage stamp with a hexagon inside: the sender paid for the write with a stamp of their own. */
export const OwnStampIcon: React.FC = () => (
  <svg className="sender-own-stamp" width="15" height="15" viewBox="0 0 16 16" aria-hidden="true">
    <path
      className="sender-own-stamp-edge"
      d="M2.5 2.5h11v11h-11z"
      fill="none"
      strokeWidth="1.2"
      strokeDasharray="1.6 1.1"
    />
    <path className="sender-own-stamp-hexagon" d="M8 4.6 10.9 6.3v3.4L8 11.4 5.1 9.7V6.3Z" />
  </svg>
);
