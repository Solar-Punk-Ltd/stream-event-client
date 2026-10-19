import { useRef, useState } from 'react';

import { fullAddress, shortAddress } from './addressText';
import { useClipboardCopy } from './useClipboardCopy';

import './ShortAddress.scss';

const COPY_TEXT = 'Copy';
const COPIED_TEXT = 'Copied';

interface ShortAddressProps {
  /** The hex value, with or without its `0x`. */
  readonly value: string;
  /** What the value is, in lower case, as the copy button names it: "public address", "signature". */
  readonly label: string;
}

/**
 * A hex value in its short form, which a press expands to the full value with a copy button beside it, and a second
 * press folds back.
 */
export function ShortAddress({ value, label }: ShortAddressProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const valueRef = useRef<HTMLSpanElement>(null);
  const { isCopied, copy, forget } = useClipboardCopy(valueRef);
  const full = fullAddress(value);

  return (
    <span className={isExpanded ? 'short-address expanded' : 'short-address'}>
      <button
        type="button"
        className="short-address-toggle"
        aria-expanded={isExpanded}
        title={isExpanded ? `Show the short ${label}` : `Show the full ${label}`}
        onClick={() => {
          setIsExpanded((expanded) => !expanded);
          forget();
        }}
      >
        <span ref={valueRef} className="short-address-value">
          {isExpanded ? full : shortAddress(value)}
        </span>
      </button>
      {isExpanded && (
        <button
          type="button"
          className="short-address-copy"
          aria-label={`Copy the ${label}`}
          onClick={() => copy(full)}
        >
          {isCopied ? COPIED_TEXT : COPY_TEXT}
        </button>
      )}
      {/* The button's name stays put while its text flips, so the result is read out from here. */}
      <span className="short-address-status" role="status">
        {isCopied ? `Copied the ${label}` : ''}
      </span>
    </span>
  );
}
