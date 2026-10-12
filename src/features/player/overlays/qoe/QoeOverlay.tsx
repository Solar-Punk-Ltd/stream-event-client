import React, { type RefObject, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import { browserStorage } from '@/app/browserStorage';
import { BUILD_LABEL } from '@/shared/buildLabel';
import { BarChartIcon } from '@/shared/components/Icons/BarChartIcon';
import { MoveIcon } from '@/shared/components/Icons/MoveIcon';

import {
  exitFullscreenOf,
  fullscreenElementOf,
  FULLSCREEN_EVENTS,
  fullscreenHandOver,
  panelHost,
  raiseToTopLayer,
  requestFullscreenOn,
} from './qoeFullscreen';
import {
  type Bounds,
  buttonOf,
  cursorFor,
  DEFAULT_PANEL_HEIGHT,
  DEFAULT_PANEL_WIDTH,
  defaultRect,
  MIN_PANEL_SIZE,
  moveHiddenRect,
  moveRect,
  panelAtButton,
  type PlayerBox,
  reclampRect,
  RESIZE_EDGES,
  type Rect,
  type ResizeEdge,
  resizeRect,
  usableBounds,
  viewportBounds,
} from './qoeGeometry';
import { loadPanelState, savePanelState } from './qoePanelStorage';
import { QOE_PANEL_NAME, QoePanel } from './QoePanel';
import { QoeMetrics } from './useHlsQoeMetrics';

import './QoeOverlay.scss';

/** The browser window's visible area, or null while it measures nothing on a side, which every reader then skips. */
function measureViewport(): Bounds | null {
  if (typeof document === 'undefined') {
    return null;
  }
  const { clientWidth, clientHeight } = document.documentElement;
  const bounds = viewportBounds(clientWidth, clientHeight);
  return usableBounds(bounds) ? bounds : null;
}

/** The player's box on the page, or the window's top edge where there is no player to place the default by. */
function playerBox(player: HTMLElement | null | undefined, bounds: Bounds): PlayerBox {
  if (!player) {
    return { left: bounds.x, top: bounds.y, width: bounds.width };
  }
  const { left, top, width } = player.getBoundingClientRect();
  return { left, top, width };
}

const sameRect = (a: Rect | null, b: Rect) =>
  a != null && a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;

/** A key pressed while typing, in the chat's field or any other, is the text's and not the panel's shortcut. */
function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }
  return target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName);
}

/**
 * Q on its own, pressed once, outside a field: not a chord the browser owns, not the repeats of a held
 * key, and not a key an input method is composing a character from.
 */
function isPanelShortcut(e: KeyboardEvent): boolean {
  if (e.key !== 'q' && e.key !== 'Q') {
    return false;
  }
  return !e.ctrlKey && !e.metaKey && !e.altKey && !e.repeat && !e.isComposing && !isTyping(e.target);
}

interface QoeOverlayProps {
  metrics: QoeMetrics;
  /** The build label shown under the panel's header. Left out, this viewer's own. Null shows no build line. */
  release?: string | null;
  /** The stream's topic, which names the file the panel's Save writes. */
  topic?: string;
  /** The player, whose top right corner the panel opens at when nothing is saved. */
  playerRef?: RefObject<HTMLElement | null>;
}

/**
 * The toggle button and, below it, the metrics panel, which resizes from every edge and corner like a
 * desktop window. Ported from Nandor Komlodi's panel in the streaming monorepo's client. It lives in
 * the browser window rather than in the player: fixed to the viewport, rendered in the page's body or
 * the element in full screen, and drawn in the top layer (see qoeFullscreen.ts). All of the geometry,
 * one panel rectangle in viewport px with the button on its top-right corner, kept inside the window,
 * is in qoeGeometry.ts. This component feeds it pointer deltas and the window's size, and remembers the
 * result and whether the panel was open in this browser (qoePanelStorage.ts).
 */
export const QoeOverlay: React.FC<QoeOverlayProps> = ({ metrics, release = BUILD_LABEL, topic, playerRef }) => {
  const [visible, setVisible] = useState(true);
  // Null until the window has been measured, which a server render never does.
  const [rect, setRectState] = useState<Rect | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [resizing, setResizing] = useState<ResizeEdge | null>(null);
  // Null until mounted: a server render has no document to render into, so it renders in place.
  const [host, setHost] = useState<Element | null>(null);
  const [fullscreenChanges, setFullscreenChanges] = useState(0);

  // The latest rectangle and visibility, for the handlers and observers that outlive a render. While
  // the panel is hidden the rectangle keeps its size and the button still derives from it, but only
  // the button is kept inside the window (see qoeGeometry.ts).
  const rectRef = useRef<Rect | null>(null);
  const visibleRef = useRef(true);
  const drag = useRef<{ pointerId: number; startX: number; startY: number; start: Rect; bounds: Bounds } | null>(null);
  const didDrag = useRef(false);
  const resize = useRef<{
    pointerId: number;
    edge: ResizeEdge;
    startX: number;
    startY: number;
    start: Rect;
    bounds: Bounds;
  } | null>(null);
  const overlayRef = useRef<HTMLDivElement>(null);

  const setRect = useCallback((next: Rect) => {
    if (sameRect(rectRef.current, next)) {
      return;
    }
    rectRef.current = next;
    setRectState(next);
  }, []);

  const remember = useCallback((next: Rect, open: boolean) => {
    savePanelState(browserStorage(), { ...next, open });
  }, []);

  useLayoutEffect(() => {
    setHost(panelHost(fullscreenElementOf(document), document.body));
  }, []);

  // Before the first paint: where the panel was left, pulled back inside the window, or the default at
  // the player's top right. A window not measurable yet gets it from the first usable reading below.
  // It waits for the host, because the player's ref is attached only after this, its child, has
  // committed once, and the panel is not shown before it has a host.
  const placed = useRef(false);
  useLayoutEffect(() => {
    if (!host || placed.current) {
      return;
    }
    placed.current = true;
    const bounds = measureViewport();
    if (!bounds) {
      return;
    }
    const saved = loadPanelState(browserStorage());
    if (saved) {
      visibleRef.current = saved.open;
      setVisible(saved.open);
      setRect(reclampRect(saved, bounds, saved.open));
    } else {
      setRect(defaultRect(playerBox(playerRef?.current, bounds), bounds));
    }
  }, [host, setRect, playerRef]);

  // The window resizes, or the panel's window becomes the screen or the page again: clamp into the
  // area now visible. Not saved, so a brief resize does not overwrite what the viewer chose.
  const reclamp = useCallback(() => {
    const bounds = measureViewport();
    if (!bounds) {
      return;
    }
    const current = rectRef.current;
    setRect(
      current
        ? reclampRect(current, bounds, visibleRef.current)
        : defaultRect(playerBox(playerRef?.current, bounds), bounds),
    );
  }, [setRect, playerRef]);

  useEffect(() => {
    window.addEventListener('resize', reclamp);
    return () => window.removeEventListener('resize', reclamp);
  }, [reclamp]);

  // The element that was in full screen before the latest change, and whether the panel is ending full
  // screen, which leaving a stack of two elements in full screen takes one exit for each.
  const previousFullscreen = useRef<Element | null>(null);
  const leavingFullscreen = useRef(false);

  const toldOfRefusal = useRef(false);

  useEffect(() => {
    const onFullscreenChange = () => {
      const now = fullscreenElementOf(document);
      // The standard event and Safari's for the same change: the first one has handled it.
      if (now === previousFullscreen.current) {
        return;
      }
      const player = playerRef?.current;
      if (now === null) {
        leavingFullscreen.current = false;
      } else if (leavingFullscreen.current) {
        void exitFullscreenOf(document);
      } else {
        const handOver = fullscreenHandOver(now, previousFullscreen.current, player);
        if (handOver === 'to-player' && player) {
          void requestFullscreenOn(player).then((granted) => {
            // Refused, the video keeps its own full screen and the panel stays in the page, where
            // Chrome would make it inert but other browsers may not.
            if (!granted && !toldOfRefusal.current) {
              toldOfRefusal.current = true;
              console.debug(
                'QoE panel: the browser refused to put the player in full screen, so the panel stays in the page.',
              );
            }
          });
        } else if (handOver === 'exit') {
          leavingFullscreen.current = true;
          void exitFullscreenOf(document);
        }
      }
      previousFullscreen.current = now;
      setHost(panelHost(now, document.body));
      setFullscreenChanges((n) => n + 1);
      reclamp();
    };
    for (const name of FULLSCREEN_EVENTS) {
      document.addEventListener(name, onFullscreenChange);
    }
    return () => {
      for (const name of FULLSCREEN_EVENTS) {
        document.removeEventListener(name, onFullscreenChange);
      }
    };
  }, [reclamp, playerRef]);

  // Shown in the top layer once it is in its host, and raised again above whatever entered full screen.
  useLayoutEffect(() => {
    if (host) {
      raiseToTopLayer(overlayRef.current);
    }
  }, [host, fullscreenChanges]);

  // Hiding the panel unmounts its handles, so a resize under way ends with it. Showing it hangs it at
  // the button's corner with its last size and pulls the pair back inside the window.
  const toggle = useCallback(() => {
    resize.current = null;
    setResizing(null);
    const opening = !visibleRef.current;
    visibleRef.current = opening;
    setVisible(opening);
    const bounds = measureViewport();
    const current = rectRef.current;
    if (!current) {
      return;
    }
    const next = opening && bounds ? panelAtButton(buttonOf(current), current, bounds, MIN_PANEL_SIZE) : current;
    setRect(next);
    remember(next, opening);
  }, [setRect, remember]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isPanelShortcut(e)) {
        toggle();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [toggle]);

  // No text selection anywhere on the page while the button or an edge is being dragged, and the
  // edge's cursor even where the pointer runs ahead of the handle. Restored at the end, and on unmount.
  useEffect(() => {
    if (!isDragging && !resizing) {
      return;
    }
    const { style } = document.body;
    const before = { userSelect: style.userSelect, cursor: style.cursor };
    style.userSelect = 'none';
    if (resizing) {
      style.cursor = cursorFor(resizing);
    }
    return () => {
      style.userSelect = before.userSelect;
      style.cursor = before.cursor;
    };
  }, [isDragging, resizing]);

  // Dragging the button, with a mouse, a finger or a pen, moves the button and the panel together. With
  // the panel hidden, the button alone. The pointer is captured, so the drag follows it off the button.
  const onDragStart = (e: React.PointerEvent<HTMLButtonElement>) => {
    const bounds = measureViewport();
    const start = rectRef.current;
    if (e.button !== 0 || !bounds || !start) {
      return;
    }

    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // The pointer is already gone, or capture is unsupported: moves still arrive while it is over the button.
    }
    drag.current = { pointerId: e.pointerId, startX: e.clientX, startY: e.clientY, start, bounds };
    didDrag.current = false;
    setIsDragging(true);
  };

  const onDragMove = (e: React.PointerEvent<HTMLButtonElement>) => {
    const d = drag.current;
    if (!d || d.pointerId !== e.pointerId) {
      return;
    }
    const dx = e.clientX - d.startX;
    const dy = e.clientY - d.startY;
    if (dx === 0 && dy === 0) {
      return;
    }
    didDrag.current = true;
    setRect(visibleRef.current ? moveRect(d.start, dx, dy, d.bounds) : moveHiddenRect(d.start, dx, dy, d.bounds));
  };

  const onDragEnd = (e: React.PointerEvent<HTMLButtonElement>) => {
    const d = drag.current;
    if (!d || d.pointerId !== e.pointerId) {
      return;
    }
    drag.current = null;
    setIsDragging(false);
    const button = e.currentTarget;
    if (typeof button.hasPointerCapture === 'function' && button.hasPointerCapture(e.pointerId)) {
      button.releasePointerCapture(e.pointerId);
    }
    const current = rectRef.current;
    if (didDrag.current && current) {
      // Hidden, what is saved is where the panel will open, so a reload with it open agrees.
      remember(
        visibleRef.current ? current : panelAtButton(buttonOf(current), current, d.bounds, MIN_PANEL_SIZE),
        visibleRef.current,
      );
    }
    // The click that follows the end of a drag is not a toggle.
    setTimeout(() => {
      didDrag.current = false;
    }, 0);
  };

  const handleClick = () => {
    if (!didDrag.current) {
      toggle();
    }
  };

  const onResizeStart = (edge: ResizeEdge) => (e: React.PointerEvent<HTMLDivElement>) => {
    const bounds = measureViewport();
    const start = rectRef.current;
    if (e.button !== 0 || !bounds || !start) {
      return;
    }

    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // The pointer is already gone, or capture is unsupported: moves still arrive while it is over the handle.
    }
    resize.current = { pointerId: e.pointerId, edge, startX: e.clientX, startY: e.clientY, start, bounds };
    setResizing(edge);
    e.preventDefault();
    e.stopPropagation();
  };

  const onResizeMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const r = resize.current;
    if (!r || r.pointerId !== e.pointerId) {
      return;
    }
    setRect(resizeRect(r.start, r.edge, e.clientX - r.startX, e.clientY - r.startY, r.bounds, MIN_PANEL_SIZE));
  };

  const onResizeEnd = (e: React.PointerEvent<HTMLDivElement>) => {
    const r = resize.current;
    if (!r || r.pointerId !== e.pointerId) {
      return;
    }
    resize.current = null;
    setResizing(null);
    const handle = e.currentTarget;
    if (typeof handle.hasPointerCapture === 'function' && handle.hasPointerCapture(e.pointerId)) {
      handle.releasePointerCapture(e.pointerId);
    }
    if (rectRef.current) {
      remember(rectRef.current, true);
    }
  };

  // The overlay element is the button's box. The panel's frame hangs below it, right edges aligned.
  const button = rect ? buttonOf(rect) : null;
  const floatStyle: React.CSSProperties | undefined = button
    ? { left: button.x, top: button.y, right: 'auto' }
    : undefined;
  const frameStyle: React.CSSProperties = {
    width: rect?.width ?? DEFAULT_PANEL_WIDTH,
    height: rect?.height ?? DEFAULT_PANEL_HEIGHT,
  };

  const overlay = (
    <div ref={overlayRef} className="qoe-overlay" style={floatStyle} popover="manual">
      <button
        type="button"
        className={['qoe-btn', visible ? 'qoe-btn--active' : '', isDragging ? 'qoe-btn--dragging' : '']
          .filter(Boolean)
          .join(' ')}
        onPointerDown={onDragStart}
        onPointerMove={onDragMove}
        onPointerUp={onDragEnd}
        onPointerCancel={onDragEnd}
        onLostPointerCapture={onDragEnd}
        onClick={handleClick}
        title="Toggle metrics (Q) · Drag to reposition"
        aria-label={QOE_PANEL_NAME}
        aria-pressed={visible}
      >
        <span className="qoe-btn__chart">
          <BarChartIcon />
        </span>
        <span className="qoe-btn__move">
          <MoveIcon />
        </span>
        {visible && <span className="qoe-btn__live" />}
      </button>

      {visible && (
        <div className="qoe-overlay__frame" style={frameStyle}>
          {RESIZE_EDGES.map((edge) => (
            <div
              key={edge}
              className={`qoe-overlay__handle qoe-overlay__handle--${edge}`}
              style={{ cursor: cursorFor(edge) }}
              aria-hidden="true"
              onPointerDown={onResizeStart(edge)}
              onPointerMove={onResizeMove}
              onPointerUp={onResizeEnd}
              onPointerCancel={onResizeEnd}
              onLostPointerCapture={onResizeEnd}
            />
          ))}
          <QoePanel metrics={metrics} release={release} topic={topic} />
        </div>
      )}
    </div>
  );

  return host ? createPortal(overlay, host) : overlay;
};
