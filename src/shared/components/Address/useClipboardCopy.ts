import { type RefObject, useCallback, useEffect, useLayoutEffect, useState } from 'react';

const COPIED_SHOWN_MS = 3_000;

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
 * Copies text to the clipboard and says for three seconds that it did. Where the browser refuses the clipboard, it
 * says so with `isRefused`, so the caller can show the full text in `shown`, which is then selected.
 */
export function useClipboardCopy(shown: RefObject<HTMLElement | null>) {
  const [isCopied, setIsCopied] = useState(false);
  /** How many copies the browser refused, so each refusal selects the text again. */
  const [refusals, setRefusals] = useState(0);

  useLayoutEffect(() => {
    if (refusals > 0) {
      selectText(shown.current);
    }
  }, [refusals, shown]);

  useEffect(() => {
    if (!isCopied) {
      return;
    }
    const timer = setTimeout(() => setIsCopied(false), COPIED_SHOWN_MS);
    return () => clearTimeout(timer);
  }, [isCopied]);

  const copy = useCallback((text: string) => {
    // The clipboard is asked inside the click, the one moment a browser lets a page write to it.
    const written = navigator.clipboard?.writeText(text) ?? Promise.reject(new Error('no clipboard'));
    written.then(
      () => setIsCopied(true),
      () => {
        setIsCopied(false);
        setRefusals((count) => count + 1);
      },
    );
  }, []);

  const forget = useCallback(() => {
    setIsCopied(false);
    setRefusals(0);
  }, []);

  return { isCopied, isRefused: refusals > 0, copy, forget };
}
