import { type RefObject, useEffect } from 'react';

/**
 * How much shorter than its full height the visible area must be before the keyboard counts as up. An address bar
 * that shows or hides moves it by about 56 px, a phone's keyboard by 250 px or more.
 */
const KEYBOARD_MIN_HEIGHT_PX = 150;

/** The height of what is visible, in layout pixels, so a pinch zoom does not read as a keyboard. */
function visibleHeight(): number {
  const viewport = window.visualViewport;
  return viewport ? viewport.height * viewport.scale : window.innerHeight;
}

/**
 * While the field has focus and a keyboard is up, brings it back into view whenever the page or the visible area
 * changes size. A phone's browser scrolls a field into view once, when the keyboard opens. Content that arrives
 * above the field afterwards, or a keyboard that finishes opening after that scroll, leaves the field and its typed
 * text under the keyboard. The visual viewport is the part of the page the keyboard leaves visible.
 *
 * A field keeps focus after its keyboard is dismissed with Back, and a viewer may then scroll up to the video. With no
 * keyboard up nothing is pulled back, so the page stays where they put it.
 */
export function useFieldStaysInView(fieldRef: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    const field = fieldRef.current;
    if (!field) return;

    let stopWatching: (() => void) | null = null;

    const startWatching = () => {
      stopWatching?.();
      // The tallest the visible area has been while watching. A browser that shrinks the whole page for the keyboard
      // moves `innerHeight` with it, so the height before the keyboard opened is the only fixed point.
      let fullHeight = Math.max(window.innerHeight, visibleHeight());
      const bringIntoView = () => {
        const height = visibleHeight();
        fullHeight = Math.max(fullHeight, height);
        const keyboardUp = fullHeight - height >= KEYBOARD_MIN_HEIGHT_PX;
        if (keyboardUp && document.activeElement === field) field.scrollIntoView({ block: 'nearest' });
      };
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
