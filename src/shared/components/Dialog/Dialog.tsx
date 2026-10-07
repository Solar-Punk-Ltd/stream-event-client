import { ReactNode, useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import './Dialog.scss';

const KEY_ESCAPE = 'Escape';
const KEY_TAB = 'Tab';

const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

interface DialogProps {
  title: string;
  onClose: () => void;
  /** Puts a close button beside the title, named this for a screen reader. */
  closeLabel?: string;
  /** Kept in view under the body, which scrolls between it and the title when it is long. */
  footer?: ReactNode;
  children: ReactNode;
}

/**
 * A modal dialog: focus moves inside when it opens and cannot leave by Tab, Escape or a click on the
 * backdrop closes it, and focus goes back to whatever had it before, usually the button that opened
 * it. Rendered into the body so no ancestor's stacking or overflow can clip it.
 *
 * Built by hand rather than on the `<dialog>` element because the declared browser floor includes
 * Safari 14, which has no `showModal`.
 */
export function Dialog({ title, onClose, closeLabel, footer, children }: DialogProps) {
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  // Read through a ref so a parent passing a new function each render does not re-run the effect,
  // which would hand focus back and take it again on every keystroke.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  // Taken on the first render, before anything inside with `autoFocus` has moved focus in, which
  // happens before any effect runs.
  const [previouslyFocused] = useState(() => document.activeElement as HTMLElement | null);

  useEffect(() => {
    const panel = panelRef.current;
    if (panel && !panel.contains(document.activeElement)) {
      firstFocusable(panel).focus();
    }

    // On the document rather than on the panel: a control that disables itself while it works, as
    // the picker's check does, drops focus to the page, and a listener on the panel would then hear
    // neither Escape nor Tab.
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === KEY_ESCAPE) {
        event.stopPropagation();
        onCloseRef.current();
        return;
      }
      if (event.key === KEY_TAB && panel) {
        keepTabInside(event, panel);
      }
    };
    document.addEventListener('keydown', onKeyDown);

    return () => {
      document.removeEventListener('keydown', onKeyDown);
      previouslyFocused?.focus?.();
    };
  }, [previouslyFocused]);

  return createPortal(
    <div className="dialog-backdrop" onClick={() => onCloseRef.current()}>
      <div
        ref={panelRef}
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="dialog-header">
          <h2 id={titleId} className="dialog-title">
            {title}
          </h2>
          {closeLabel !== undefined && (
            <button type="button" className="dialog-close" aria-label={closeLabel} onClick={() => onCloseRef.current()}>
              <span aria-hidden="true">×</span>
            </button>
          )}
        </div>
        <div className="dialog-body">{children}</div>
        {footer !== undefined && <div className="dialog-footer">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}

function focusableIn(panel: HTMLElement): HTMLElement[] {
  return [...panel.querySelectorAll<HTMLElement>(FOCUSABLE)];
}

function firstFocusable(panel: HTMLElement): HTMLElement {
  return focusableIn(panel)[0] ?? panel;
}

function keepTabInside(event: KeyboardEvent, panel: HTMLElement) {
  const focusable = focusableIn(panel);
  if (focusable.length === 0 || !panel.contains(document.activeElement)) {
    event.preventDefault();
    firstFocusable(panel).focus();
    return;
  }
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}
