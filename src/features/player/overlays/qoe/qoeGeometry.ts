/**
 * Where the QoE panel sits and how big it is. Pure: no React, no DOM.
 *
 * Ported from Nandor Komlodi's panel in the streaming monorepo's client, with one change of frame:
 * there the panel was positioned inside the player and its bounds were the window seen from the
 * player, here it is fixed to the browser window itself, so every rectangle is in viewport px and
 * the bounds are the viewport (`viewportBounds`). A scroll no longer moves it, and the player, which
 * clips what overflows it, can no longer hide it.
 *
 * The model is one rectangle, the panel's `{ x, y, width, height }`. Everything else follows from it:
 *
 * - The toggle button sits on the panel's top-right corner, above it: the button's right edge is
 *   the panel's right edge and its bottom is 4 px above the panel's top. So the area the overlay
 *   occupies is the panel plus a band of `BUTTON_BAND` px above it, and that whole area is what is
 *   kept inside the window: `x >= bounds.x`, `x + width <= bounds.x + bounds.width`,
 *   `y >= bounds.y + BUTTON_BAND`, `y + height <= bounds.y + bounds.height`.
 * - Dragging the button moves the rectangle (`moveRect`). Dragging an edge or a corner of the panel
 *   moves that edge and holds the opposite one (`resizeRect`). The n edge moves the panel's top, and
 *   the button with it.
 * - A hidden panel keeps its rectangle, size and all, and the button still derives from it. Only the
 *   button's own 32 px box is then kept inside the window (`moveButton`), so the rectangle may lie
 *   partly outside it: the panel isn't drawn, and its size must not box the button in. Shown again,
 *   the panel hangs at the button's corner with its last size and the pair is pulled back inside
 *   together (`panelAtButton`), the button moving with it if it has to.
 * - A saved or stale rectangle, and one whose window has just changed size, entering or leaving full
 *   screen included, is pulled back in by `clampRect`: shrunk to fit first, never below the minimum,
 *   then moved inside.
 */

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** The browser window's visible area: its top-left corner, 0, 0 for the viewport, and its size. */
export interface Bounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface Size {
  width: number;
  height: number;
}

/** The toggle button's top-left corner. */
interface Point {
  x: number;
  y: number;
}

export type ResizeEdge = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';

export const RESIZE_EDGES: readonly ResizeEdge[] = ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'];

/** The round toggle button, as QoeOverlay.scss draws it. */
export const BUTTON_SIZE = 32;
/** The space between the button's bottom and the panel's top. */
const BUTTON_GAP = 4;
/** The band above the panel that the button occupies, which the bounds apply to as well. */
export const BUTTON_BAND = BUTTON_SIZE + BUTTON_GAP;

/**
 * The smallest panel. 160 px wide holds a short label and its value on one line at the panel's
 * 11 px monospace (about 20 characters after the padding), and lets a long row wrap onto two lines
 * rather than one word per line. 120 px tall shows the header and four or five rows, enough to read
 * a section and to see that the panel scrolls.
 */
export const MIN_PANEL_SIZE: Size = { width: 160, height: 120 };

/** The button's default place, where it has always opened: 50 px in from the player's right, 10 below its top. */
const DEFAULT_BUTTON_RIGHT_OFFSET = 50;
const DEFAULT_BUTTON_TOP = 10;
/**
 * The owner's default width. Inside its 1 px border and 10 px padding it leaves 228 px, about 33
 * characters of the 11 px monospace once the rows' 8 px gap is taken: a label with its usual value
 * fits on one line. A deployed build's release line wraps at this width, and so does a ladder rung
 * marked both capped and unaffordable.
 */
export const DEFAULT_PANEL_WIDTH = 250;
/**
 * The owner's default height, tall enough for every row of a local build's panel with a three-rung
 * ladder. A deployed build's release line, a longer ladder or a rung that wraps add lines, which
 * scroll. It is shortened to the space down to the window's bottom where there is less.
 */
export const DEFAULT_PANEL_HEIGHT = 800;

const finiteOr0 = (n: number) => (Number.isFinite(n) ? n : 0);

/**
 * The position of a span `size` long kept within `[lo, hi]`. In a window too small for it, which no
 * real browser window is, it aligns to `hi` when `alignHigh`, otherwise to `lo`: right and top, which
 * keeps the toggle button, the control that hides the panel again, in view.
 */
function clampAxis(pos: number, size: number, lo: number, hi: number, alignHigh: boolean): number {
  if (size > hi - lo) {
    return alignHigh ? hi - size : lo;
  }
  return Math.min(Math.max(pos, lo), hi - size);
}

/** The position of `rect`, size kept, moved inside the window, its button band included. */
function placeInside(rect: Rect, bounds: Bounds): Rect {
  return {
    x: clampAxis(rect.x, rect.width, bounds.x, bounds.x + bounds.width, true),
    y: clampAxis(rect.y, rect.height, bounds.y + BUTTON_BAND, bounds.y + bounds.height, false),
    width: rect.width,
    height: rect.height,
  };
}

/**
 * `start` with `edge` dragged by `(dx, dy)`. The opposite edge or corner stays fixed. A side stops at
 * the minimum size, still holding the opposite side, and at the window's edges, the top at the button
 * band below the window's top.
 */
export function resizeRect(start: Rect, edge: ResizeEdge, dx: number, dy: number, bounds: Bounds, min: Size): Rect {
  dx = finiteOr0(dx);
  dy = finiteOr0(dy);
  let left = start.x;
  let top = start.y;
  let right = start.x + start.width;
  let bottom = start.y + start.height;

  if (edge.includes('w')) {
    left = Math.min(right - min.width, Math.max(bounds.x, left + dx));
  } else if (edge.includes('e')) {
    right = Math.max(left + min.width, Math.min(bounds.x + bounds.width, right + dx));
  }
  if (edge.includes('n')) {
    top = Math.min(bottom - min.height, Math.max(bounds.y + BUTTON_BAND, top + dy));
  } else if (edge.includes('s')) {
    bottom = Math.max(top + min.height, Math.min(bounds.y + bounds.height, bottom + dy));
  }

  return { x: left, y: top, width: right - left, height: bottom - top };
}

/** `start` dragged by `(dx, dy)`, its size kept and its position kept inside the window. */
export function moveRect(start: Rect, dx: number, dy: number, bounds: Bounds): Rect {
  return placeInside({ ...start, x: start.x + finiteOr0(dx), y: start.y + finiteOr0(dy) }, bounds);
}

/** `rect` shrunk to fit the window, never below `min`, then moved inside it. */
export function clampRect(rect: Rect, bounds: Bounds, min: Size): Rect {
  const width = Math.max(min.width, Math.min(rect.width, bounds.width));
  const height = Math.max(min.height, Math.min(rect.height, bounds.height - BUTTON_BAND));
  return placeInside({ x: rect.x, y: rect.y, width, height }, bounds);
}

/** The button of a panel rectangle: on its top-right corner, `BUTTON_GAP` px above it. */
export function buttonOf(rect: Rect): Point {
  return { x: rect.x + rect.width - BUTTON_SIZE, y: rect.y - BUTTON_BAND };
}

/** The panel rectangle of `size` hanging at `button`'s corner, as it is, unclamped. */
export function rectAtButton(button: Point, size: Size): Rect {
  return { x: button.x + BUTTON_SIZE - size.width, y: button.y + BUTTON_BAND, width: size.width, height: size.height };
}

/** The button dragged by `(dx, dy)` while the panel is hidden: only its own box is kept inside the window. */
export function moveButton(button: Point, dx: number, dy: number, bounds: Bounds): Point {
  return {
    x: clampAxis(button.x + finiteOr0(dx), BUTTON_SIZE, bounds.x, bounds.x + bounds.width, true),
    y: clampAxis(button.y + finiteOr0(dy), BUTTON_SIZE, bounds.y, bounds.y + bounds.height, false),
  };
}

/**
 * A hidden panel's rectangle with its button dragged by `(dx, dy)`: the size kept, the rectangle
 * following the button, and only the button kept inside the window. With `dx = dy = 0`, the clamp
 * of a hidden panel when the window resizes.
 */
export function moveHiddenRect(start: Rect, dx: number, dy: number, bounds: Bounds): Rect {
  return rectAtButton(moveButton(buttonOf(start), dx, dy, bounds), start);
}

/**
 * The panel shown again: `size` hung at `button`'s corner, then the pair shrunk to fit and moved
 * inside the window like any other rectangle (`clampRect`). The button is wherever the result puts it.
 */
export function panelAtButton(button: Point, size: Size, bounds: Bounds, min: Size): Rect {
  return clampRect(rectAtButton(button, size), bounds, min);
}

/** The viewport as bounds: `document.documentElement.clientWidth` and `clientHeight`, scrollbars left out. */
export function viewportBounds(width: number, height: number): Bounds {
  return { x: 0, y: 0, width, height };
}

/**
 * Whether a reading of the window can be clamped to. One that measures 0 on a side (a document not
 * laid out yet, a frame collapsed to nothing) or is not a number would crush the geometry, and the
 * next drag would save it. Such a reading is ignored and the geometry left as it was.
 */
export function usableBounds(bounds: Bounds | null | undefined): bounds is Bounds {
  return (
    bounds != null &&
    Number.isFinite(bounds.x) &&
    Number.isFinite(bounds.y) &&
    Number.isFinite(bounds.width) &&
    Number.isFinite(bounds.height) &&
    bounds.width > 0 &&
    bounds.height > 0
  );
}

/**
 * `rect` clamped again after the window resized: the panel and its button together while the panel
 * is shown, the button alone while it is hidden. Untouched for a reading that is not `usableBounds`.
 */
export function reclampRect(rect: Rect, bounds: Bounds, visible: boolean): Rect {
  if (!usableBounds(bounds)) {
    return rect;
  }
  return visible ? clampRect(rect, bounds, MIN_PANEL_SIZE) : moveHiddenRect(rect, 0, 0, bounds);
}

/** The player's box on the page, in viewport px, as `getBoundingClientRect` reports it. */
export interface PlayerBox {
  left: number;
  top: number;
  width: number;
}

/**
 * The panel when nothing is saved: the button where it has always opened, at the top right of the
 * player, and the panel hanging below it, over the page below a short player, shortened to the space
 * down to the window's bottom and then clamped to the window.
 */
export function defaultRect(player: PlayerBox, bounds: Bounds): Rect {
  const right = player.left + player.width - DEFAULT_BUTTON_RIGHT_OFFSET + BUTTON_SIZE;
  const y = player.top + DEFAULT_BUTTON_TOP + BUTTON_BAND;
  const height = Math.min(DEFAULT_PANEL_HEIGHT, bounds.y + bounds.height - y);
  return clampRect({ x: right - DEFAULT_PANEL_WIDTH, y, width: DEFAULT_PANEL_WIDTH, height }, bounds, MIN_PANEL_SIZE);
}

/** The cursor that shows which way an edge or corner resizes. */
export function cursorFor(edge: ResizeEdge): 'ns-resize' | 'ew-resize' | 'nwse-resize' | 'nesw-resize' {
  switch (edge) {
    case 'n':
    case 's':
      return 'ns-resize';
    case 'e':
    case 'w':
      return 'ew-resize';
    case 'nw':
    case 'se':
      return 'nwse-resize';
    case 'ne':
    case 'sw':
      return 'nesw-resize';
  }
}
