import { type RefObject, useEffect } from 'react';

/**
 * While the field has focus, brings it back into view whenever the page or the visible area changes size. A phone's
 * browser scrolls a field into view once, when the keyboard opens. Content that arrives above the field afterwards,
 * or a keyboard that finishes opening after that scroll, leaves the field and its typed text under the keyboard.
 * The visual viewport is the part of the page the keyboard leaves visible.
 */
export function useFieldStaysInView(fieldRef: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    const field = fieldRef.current;
    if (!field) return;

    let stopWatching: (() => void) | null = null;

    const bringIntoView = () => {
      if (document.activeElement === field) field.scrollIntoView({ block: 'nearest' });
    };

    const startWatching = () => {
      stopWatching?.();
      const page = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(bringIntoView);
      page?.observe(document.documentElement);
      window.visualViewport?.addEventListener('resize', bringIntoView);
      stopWatching = () => {
        page?.disconnect();
        window.visualViewport?.removeEventListener('resize', bringIntoView);
        stopWatching = null;
      };
    };
    const endWatching = () => stopWatching?.();

    field.addEventListener('focus', startWatching);
    field.addEventListener('blur', endWatching);
    return () => {
      field.removeEventListener('focus', startWatching);
      field.removeEventListener('blur', endWatching);
      endWatching();
    };
  }, [fieldRef]);
}
