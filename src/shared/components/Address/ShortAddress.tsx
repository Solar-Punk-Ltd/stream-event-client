import { useRef, useState } from 'react';

import { fullAddress, shortAddress } from './addressText';

import './ShortAddress.scss';

const COPY_TEXT = 'Copy';
const COPIED_TEXT = 'Copied';

interface ShortAddressProps {
  /** The hex value, with or without its `0x`. */
  readonly value: string;
  /** What the value is, in lower case, as the copy button names it: "public address", "signature". */
  readonly label: string;
}

/** Selects the whole text of an element, so a viewer whose browser refused the clipboard can copy it by hand. */
function selectText(element: HTMLElement | null) {
  const selection = window.getSelection();
  if (!element || !selection) {
    return;
  }
  const range = document.createRange();
  range.selectNodeContents(element);
  selection.removeAllRanges();
  selection.addRange(range);
}

/**
 * A hex value in its short form, which a press expands to the full value with a copy button beside it, and a second
 * press folds back.
 */
export function ShortAddress({ value, label }: ShortAddressProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [isCopied, setIsCopied] = useState(false);
  const valueRef = useRef<HTMLSpanElement>(null);
  const full = fullAddress(value);

  const copy = () => {
    // The clipboard is asked inside the click, the one moment a browser lets a page write to it.
    const written = navigator.clipboard?.writeText(full) ?? Promise.reject(new Error('no clipboard'));
    written.then(
      () => setIsCopied(true),
      () => {
        setIsCopied(false);
        selectText(valueRef.current);
      },
    );
  };

  return (
    <span className={isExpanded ? 'short-address expanded' : 'short-address'}>
      <button
        type="button"
        className="short-address-toggle"
        aria-expanded={isExpanded}
        title={isExpanded ? `Show the short ${label}` : `Show the full ${label}`}
        onClick={() => {
          setIsExpanded((expanded) => !expanded);
          setIsCopied(false);
        }}
      >
        <span ref={valueRef} className="short-address-value">
          {isExpanded ? full : shortAddress(value)}
        </span>
      </button>
      {isExpanded && (
        <button type="button" className="short-address-copy" aria-label={`Copy the ${label}`} onClick={copy}>
          {isCopied ? COPIED_TEXT : COPY_TEXT}
        </button>
      )}
    </span>
  );
}
