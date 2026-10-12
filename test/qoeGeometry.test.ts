import assert from 'node:assert/strict';
import { describe, it } from 'vitest';

import {
  BUTTON_BAND,
  BUTTON_SIZE,
  type Bounds,
  buttonOf,
  clampRect,
  cursorFor,
  DEFAULT_PANEL_HEIGHT,
  DEFAULT_PANEL_WIDTH,
  defaultRect,
  MIN_PANEL_SIZE,
  moveButton,
  moveHiddenRect,
  moveRect,
  panelAtButton,
  type Rect,
  type ResizeEdge,
  reclampRect,
  rectAtButton,
  resizeRect,
  usableBounds,
  viewportBounds,
} from '../src/features/player/overlays/qoe/qoeGeometry';

/** A window seen from a player at its top-left corner: the origin is 0, 0. */
const BOUNDS: Bounds = { x: 0, y: 0, width: 1000, height: 800 };
const MIN = MIN_PANEL_SIZE;
/** A panel well inside the window, with room on every side. */
const START: Rect = { x: 300, y: 200, width: 300, height: 300 };

const right = (r: Rect) => r.x + r.width;
const bottom = (r: Rect) => r.y + r.height;

describe('resizeRect: which sides move', () => {
  const cases: Array<{ edge: ResizeEdge; moves: Array<'left' | 'right' | 'top' | 'bottom'> }> = [
    { edge: 'n', moves: ['top'] },
    { edge: 's', moves: ['bottom'] },
    { edge: 'e', moves: ['right'] },
    { edge: 'w', moves: ['left'] },
    { edge: 'ne', moves: ['top', 'right'] },
    { edge: 'nw', moves: ['top', 'left'] },
    { edge: 'se', moves: ['bottom', 'right'] },
    { edge: 'sw', moves: ['bottom', 'left'] },
  ];

  for (const { edge, moves } of cases) {
    it(`the ${edge} handle moves ${moves.join(' and ')} by the drag and holds the other sides`, () => {
      const r = resizeRect(START, edge, 20, 30, BOUNDS, MIN);

      assert.equal(r.x, START.x + (moves.includes('left') ? 20 : 0), 'left');
      assert.equal(right(r), right(START) + (moves.includes('right') ? 20 : 0), 'right');
      assert.equal(r.y, START.y + (moves.includes('top') ? 30 : 0), 'top');
      assert.equal(bottom(r), bottom(START) + (moves.includes('bottom') ? 30 : 0), 'bottom');
    });
  }

  it('does not change the rect it was given', () => {
    const start = { ...START };
    resizeRect(start, 'se', 50, 50, BOUNDS, MIN);
    assert.deepEqual(start, START);
  });
});

describe('resizeRect: the minimum size holds the opposite edge', () => {
  it('stops the w edge at the minimum width with the right edge unmoved', () => {
    const r = resizeRect(START, 'w', 1000, 0, BOUNDS, MIN);
    assert.equal(r.width, MIN.width);
    assert.equal(right(r), right(START));
  });

  it('stops the e edge at the minimum width with the left edge unmoved', () => {
    const r = resizeRect(START, 'e', -1000, 0, BOUNDS, MIN);
    assert.equal(r.width, MIN.width);
    assert.equal(r.x, START.x);
  });

  it('stops the n edge at the minimum height with the bottom edge unmoved', () => {
    const r = resizeRect(START, 'n', 0, 1000, BOUNDS, MIN);
    assert.equal(r.height, MIN.height);
    assert.equal(bottom(r), bottom(START));
  });

  it('stops the s edge at the minimum height with the top edge unmoved', () => {
    const r = resizeRect(START, 's', 0, -1000, BOUNDS, MIN);
    assert.equal(r.height, MIN.height);
    assert.equal(r.y, START.y);
  });

  it('stops a corner at the minimum on both axes, holding the opposite corner', () => {
    const r = resizeRect(START, 'nw', 1000, 1000, BOUNDS, MIN);
    assert.deepEqual(r, {
      x: right(START) - MIN.width,
      y: bottom(START) - MIN.height,
      width: MIN.width,
      height: MIN.height,
    });
  });
});

describe('resizeRect: the window bounds', () => {
  it('stops the w edge at the window left', () => {
    const r = resizeRect(START, 'w', -1000, 0, BOUNDS, MIN);
    assert.equal(r.x, 0);
    assert.equal(right(r), right(START));
  });

  it('stops the e edge at the window right', () => {
    const r = resizeRect(START, 'e', 1000, 0, BOUNDS, MIN);
    assert.equal(right(r), BOUNDS.width);
    assert.equal(r.x, START.x);
  });

  it('stops the s edge at the window bottom', () => {
    const r = resizeRect(START, 's', 0, 1000, BOUNDS, MIN);
    assert.equal(bottom(r), BOUNDS.height);
    assert.equal(r.y, START.y);
  });

  it('stops the n edge where the toggle button above the panel meets the window top', () => {
    const r = resizeRect(START, 'n', 0, -1000, BOUNDS, MIN);
    assert.equal(r.y, BUTTON_BAND);
    assert.equal(bottom(r), bottom(START));
  });

  it('clamps a corner on both axes at once', () => {
    const r = resizeRect(START, 'ne', 1000, -1000, BOUNDS, MIN);
    assert.deepEqual(r, {
      x: START.x,
      y: BUTTON_BAND,
      width: BOUNDS.width - START.x,
      height: bottom(START) - BUTTON_BAND,
    });
  });
});

describe('moveRect', () => {
  it('moves the rect by the drag and keeps its size', () => {
    assert.deepEqual(moveRect(START, -40, 25, BOUNDS), { ...START, x: START.x - 40, y: START.y + 25 });
  });

  it('stops at the window left', () => {
    assert.deepEqual(moveRect(START, -1000, 0, BOUNDS), { ...START, x: 0 });
  });

  it('stops at the window right', () => {
    assert.deepEqual(moveRect(START, 1000, 0, BOUNDS), { ...START, x: BOUNDS.width - START.width });
  });

  it('stops with the toggle button at the window top', () => {
    assert.deepEqual(moveRect(START, 0, -1000, BOUNDS), { ...START, y: BUTTON_BAND });
  });

  it('stops at the window bottom', () => {
    assert.deepEqual(moveRect(START, 0, 1000, BOUNDS), { ...START, y: BOUNDS.height - START.height });
  });
});

describe('clampRect', () => {
  it('leaves a rect that fits as it is', () => {
    assert.deepEqual(clampRect(START, BOUNDS, MIN), START);
  });

  it('shrinks an oversize rect to the window, below the button band', () => {
    const r = clampRect({ x: 0, y: BUTTON_BAND, width: 2000, height: 2000 }, BOUNDS, MIN);
    assert.deepEqual(r, { x: 0, y: BUTTON_BAND, width: BOUNDS.width, height: BOUNDS.height - BUTTON_BAND });
  });

  it('brings a rect lying wholly outside the window back to the nearest corner', () => {
    assert.deepEqual(clampRect({ x: 5000, y: 5000, width: 300, height: 300 }, BOUNDS, MIN), {
      x: BOUNDS.width - 300,
      y: BOUNDS.height - 300,
      width: 300,
      height: 300,
    });
    assert.deepEqual(clampRect({ x: -5000, y: -5000, width: 300, height: 300 }, BOUNDS, MIN), {
      x: 0,
      y: BUTTON_BAND,
      width: 300,
      height: 300,
    });
  });

  it('pulls a partly outside rect inside without changing its size', () => {
    assert.deepEqual(clampRect({ x: 900, y: 10, width: 300, height: 300 }, BOUNDS, MIN), {
      x: BOUNDS.width - 300,
      y: BUTTON_BAND,
      width: 300,
      height: 300,
    });
  });

  it('grows a rect below the minimum to the minimum', () => {
    const r = clampRect({ x: 100, y: 100, width: 10, height: 10 }, BOUNDS, MIN);
    assert.deepEqual(r, { x: 100, y: 100, width: MIN.width, height: MIN.height });
  });
});

describe('a window smaller than the minimum panel and its button band', () => {
  const TINY: Bounds = { x: 0, y: 0, width: 100, height: 100 };

  it('keeps the minimum size, aligns to the right and to the top, so the toggle button stays inside', () => {
    const r = clampRect({ x: 0, y: 0, width: 500, height: 500 }, TINY, MIN);

    assert.equal(r.width, MIN.width);
    assert.equal(r.height, MIN.height);
    assert.equal(right(r), TINY.width);
    assert.equal(r.y, BUTTON_BAND);
    // The button sits on the panel's top-right corner, so it is inside the window.
    assert.ok(right(r) - BUTTON_SIZE >= 0);
    assert.ok(r.y - BUTTON_BAND >= 0);
  });

  it('keeps that place under a move', () => {
    const start = clampRect({ x: 0, y: 0, width: 500, height: 500 }, TINY, MIN);
    assert.deepEqual(moveRect(start, -50, 50, TINY), start);
    assert.deepEqual(moveRect(start, 50, -50, TINY), start);
  });

  it('never resizes below the minimum', () => {
    const start = clampRect({ x: 0, y: 0, width: 500, height: 500 }, TINY, MIN);
    for (const edge of ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'] as const) {
      const r = resizeRect(start, edge, 30, 30, TINY, MIN);
      assert.ok(r.width >= MIN.width, edge);
      assert.ok(r.height >= MIN.height, edge);
    }
  });

  it('makes the default the minimum in the same place', () => {
    const r = defaultRect({ left: 0, top: 0, width: TINY.width }, TINY);
    assert.deepEqual(r, { x: TINY.width - MIN.width, y: BUTTON_BAND, width: MIN.width, height: MIN.height });
  });
});

describe('defaultRect', () => {
  it('puts the toggle button 50 px in from the player right and 10 px below its top', () => {
    // A window tall enough for the whole default panel below the button, the player at its corner.
    const tall: Bounds = { x: 0, y: 0, width: 1000, height: 1000 };
    const r = defaultRect({ left: 0, top: 0, width: tall.width }, tall);
    assert.equal(right(r) - BUTTON_SIZE, tall.width - 50);
    assert.equal(r.y - BUTTON_BAND, 10);
    assert.equal(r.width, DEFAULT_PANEL_WIDTH);
    assert.equal(r.height, DEFAULT_PANEL_HEIGHT);
  });

  it('opens 250 × 800 below an audio bar, a 420 px player at 635, 163 in a 1692 × 1311 window', () => {
    const window = viewportBounds(1692, 1311);
    // The button at 635 + 420 - 50 = 1005, so the panel's right edge at 1037 and its left at 787. Its
    // top at 163 + 10 + 32 + 4 = 209, with 1311 - 209 = 1102 px left below it, more than 800.
    assert.deepEqual(defaultRect({ left: 635, top: 163, width: 420 }, window), {
      x: 787,
      y: 209,
      width: 250,
      height: 800,
    });
  });

  it("keeps the width and shortens the height to the window's bottom where that is nearer", () => {
    const window = viewportBounds(1692, 700);
    const r = defaultRect({ left: 635, top: 163, width: 420 }, window);
    assert.deepEqual(r, { x: 787, y: 209, width: 250, height: 491 });
    assert.equal(bottom(r), window.height);
  });

  it('shortens the panel to the space down to the window bottom', () => {
    const r = defaultRect({ left: 0, top: 0, width: 1000 }, { x: 0, y: 0, width: 1000, height: 300 });
    assert.equal(bottom(r), 300);
    assert.equal(r.y - BUTTON_BAND, 10);
  });

  it('opens inside the window for a player scrolled above it', () => {
    const r = defaultRect({ left: 40, top: -600, width: 900 }, viewportBounds(1280, 720));
    assert.equal(buttonOf(r).y, 0);
    assert.ok(bottom(r) <= 720);
  });
});

/**
 * While the panel is hidden only the button's own box is kept inside the window, so a hidden panel's
 * size never boxes the button in. Reopened, the panel hangs at the button's corner again and the pair
 * is pulled back inside together.
 */
describe('the button while the panel is hidden', () => {
  const SMALL: Bounds = { x: 0, y: 0, width: 640, height: 360 };
  const PANEL = defaultRect({ left: 0, top: 0, width: SMALL.width }, SMALL);
  const max = { x: SMALL.width - BUTTON_SIZE, y: SMALL.height - BUTTON_SIZE };

  it("sits on the panel rect's top-right corner, 4 px above it", () => {
    assert.deepEqual(buttonOf(START), { x: right(START) - BUTTON_SIZE, y: START.y - BUTTON_BAND });
    assert.deepEqual(buttonOf(rectAtButton({ x: 40, y: 50 }, START)), { x: 40, y: 50 });
    assert.deepEqual(
      { width: rectAtButton({ x: 40, y: 50 }, START).width, height: rectAtButton({ x: 40, y: 50 }, START).height },
      { width: START.width, height: START.height },
    );
  });

  it('moves freely to every corner of a 640×360 window whatever the default panel size', () => {
    const button = buttonOf(PANEL);
    assert.deepEqual(moveButton(button, -5000, -5000, SMALL), { x: 0, y: 0 });
    assert.deepEqual(moveButton(button, 5000, -5000, SMALL), { x: max.x, y: 0 });
    assert.deepEqual(moveButton(button, -5000, 5000, SMALL), { x: 0, y: max.y });
    assert.deepEqual(moveButton(button, 5000, 5000, SMALL), max);
    // The panel it would reopen at is far outside the window at the bottom-left, which does not matter.
    assert.ok(PANEL.height + BUTTON_BAND > SMALL.height - max.y);
  });

  it('is clamped to its own 32×32 box, and moves by the drag inside it', () => {
    assert.deepEqual(moveButton({ x: 100, y: 100 }, 25, -40, SMALL), { x: 125, y: 60 });
    assert.deepEqual(moveButton({ x: 100, y: 100 }, 1000, 0, SMALL), { x: SMALL.width - BUTTON_SIZE, y: 100 });
    assert.deepEqual(moveButton({ x: 100, y: 100 }, 0, 1000, SMALL), { x: 100, y: SMALL.height - BUTTON_SIZE });
    assert.deepEqual(moveButton({ x: 100, y: 100 }, -1000, -1000, SMALL), { x: 0, y: 0 });
  });

  it("drags a hidden panel's rect along with the button, size kept, only the button clamped", () => {
    const moved = moveHiddenRect(PANEL, -5000, 5000, SMALL);
    assert.deepEqual(buttonOf(moved), { x: 0, y: max.y });
    assert.equal(moved.width, PANEL.width);
    assert.equal(moved.height, PANEL.height);
    // A window that shrank while the panel was hidden pulls only the button back in.
    assert.deepEqual(buttonOf(moveHiddenRect(moved, 0, 0, { x: 0, y: 0, width: 200, height: 100 })), {
      x: 0,
      y: 100 - BUTTON_SIZE,
    });
  });

  it('stays at the right and the top in a window smaller than itself', () => {
    assert.deepEqual(moveButton({ x: 0, y: 0 }, 50, 50, { x: 0, y: 0, width: 20, height: 20 }), {
      x: 20 - BUTTON_SIZE,
      y: 0,
    });
  });

  it('reopened near the bottom-left, hangs the panel at its corner and moves the pair inside', () => {
    const button = { x: 0, y: max.y };
    const panel = panelAtButton(button, PANEL, SMALL, MIN);

    assert.equal(panel.width, PANEL.width);
    assert.equal(panel.height, PANEL.height);
    assert.equal(panel.x, 0);
    assert.equal(bottom(panel), SMALL.height);
    // The button came along, still on the panel's corner and inside the window.
    const moved = buttonOf(panel);
    assert.equal(moved.x + BUTTON_SIZE, right(panel));
    assert.equal(moved.y + BUTTON_BAND, panel.y);
    assert.ok(moved.y >= 0 && moved.x >= 0);
  });

  it('reopened where the panel fits, leaves the button where it is', () => {
    const button = { x: 500, y: 10 };
    const panel = panelAtButton(button, { width: 300, height: 300 }, BOUNDS, MIN);

    assert.deepEqual(panel, { x: 232, y: 46, width: 300, height: 300 });
    assert.deepEqual(buttonOf(panel), button);
  });

  it('reopened in a window that shrank, shrinks the panel to fit, never below the minimum', () => {
    const panel = panelAtButton({ x: 0, y: 0 }, { width: 2000, height: 2000 }, SMALL, MIN);
    assert.deepEqual(panel, { x: 0, y: BUTTON_BAND, width: SMALL.width, height: SMALL.height - BUTTON_BAND });
  });
});

/**
 * A window that measures 0 on a side (a document not laid out yet, a frame collapsed to nothing)
 * would crush the geometry, and the next drag would save it, so such a reading is ignored.
 */
describe('usableBounds', () => {
  it('accepts a window with a positive, finite size at a finite origin, negative included', () => {
    assert.equal(usableBounds({ x: 0, y: 0, width: 640, height: 360 }), true);
    assert.equal(usableBounds({ x: -395, y: -200, width: 1280, height: 720 }), true);
    assert.equal(usableBounds({ x: 0, y: 0, width: 1, height: 1 }), true);
  });

  it('refuses a zero, negative or not finite side or origin, and no reading at all', () => {
    for (const bounds of [
      { x: 0, y: 0, width: 0, height: 360 },
      { x: 0, y: 0, width: 640, height: 0 },
      { x: 0, y: 0, width: 0, height: 0 },
      { x: 0, y: 0, width: -640, height: 360 },
      { x: 0, y: 0, width: 640, height: -1 },
      { x: 0, y: 0, width: Number.NaN, height: 360 },
      { x: 0, y: 0, width: 640, height: Number.NaN },
      { x: 0, y: 0, width: Infinity, height: 360 },
      { x: Number.NaN, y: 0, width: 640, height: 360 },
      { x: 0, y: -Infinity, width: 640, height: 360 },
    ]) {
      assert.equal(usableBounds(bounds), false, JSON.stringify(bounds));
    }
    assert.equal(usableBounds(null), false);
  });
});

describe('reclampRect, when the window resizes', () => {
  it('leaves the rect untouched for a window measuring 0 on a side', () => {
    for (const visible of [true, false]) {
      assert.equal(reclampRect(START, { x: 0, y: 0, width: 0, height: 0 }, visible), START);
      assert.equal(reclampRect(START, { x: -10, y: -10, width: 1000, height: 0 }, visible), START);
      assert.equal(reclampRect(START, { x: 0, y: 0, width: Number.NaN, height: 800 }, visible), START);
    }
  });

  it('clamps the panel and its button together while the panel is shown', () => {
    const small = { x: 0, y: 0, width: 400, height: 300 };
    assert.deepEqual(reclampRect(START, small, true), clampRect(START, small, MIN));
  });

  it('clamps the button alone while the panel is hidden', () => {
    const small = { x: 0, y: 0, width: 400, height: 300 };
    const r = reclampRect(START, small, false);
    assert.deepEqual(r, moveHiddenRect(START, 0, 0, small));
    assert.equal(r.width, START.width);
    assert.equal(r.height, START.height);
  });

  it('re-clamps a rect that no longer fits a smaller window, at a negative origin', () => {
    const shrunk = { x: -395, y: -200, width: 800, height: 400 };
    const r = reclampRect({ x: 600, y: 300, width: 300, height: 420 }, shrunk, true);

    assert.deepEqual(r, { x: 105, y: -200 + BUTTON_BAND, width: 300, height: 400 - BUTTON_BAND });
    assert.equal(right(r), shrunk.x + shrunk.width);
    assert.equal(bottom(r), shrunk.y + shrunk.height);
  });
});

/**
 * The panel is fixed to the browser window, so its bounds are the viewport itself: the corner at
 * 0, 0 and the size of the document element's client area, scrollbars left out.
 */
describe('viewportBounds', () => {
  it('is the viewport at the origin', () => {
    assert.deepEqual(viewportBounds(1280, 720), { x: 0, y: 0, width: 1280, height: 720 });
  });
});

describe("an audio stream's player, a 490×60 bar at 395, 200 in a 1280×720 window", () => {
  const BAR = { left: 395, top: 200, width: 490, height: 60 };
  const WIN = viewportBounds(1280, 720);
  const PANEL = defaultRect(BAR, WIN);

  it('opens with the button at its default place and the panel hanging below the bar, over the page', () => {
    assert.deepEqual(buttonOf(PANEL), { x: BAR.left + BAR.width - 50, y: BAR.top + 10 });
    assert.equal(PANEL.width, DEFAULT_PANEL_WIDTH);
    assert.equal(PANEL.height, Math.min(DEFAULT_PANEL_HEIGHT, WIN.height - PANEL.y));
    assert.equal(bottom(PANEL), WIN.height);
    assert.ok(bottom(PANEL) > BAR.top + BAR.height);
  });

  it('drags the panel and its button to every corner of the window', () => {
    const topLeft = moveRect(PANEL, -5000, -5000, WIN);
    assert.equal(topLeft.x, 0);
    assert.equal(buttonOf(topLeft).y, 0);

    const bottomRight = moveRect(PANEL, 5000, 5000, WIN);
    assert.equal(right(bottomRight), WIN.width);
    assert.equal(bottom(bottomRight), WIN.height);
  });

  it("resizes vertically to the window's height less the button band", () => {
    const up = resizeRect(PANEL, 'n', 0, -5000, WIN, MIN);
    assert.equal(up.y, BUTTON_BAND);
    const tall = resizeRect(up, 's', 0, 5000, WIN, MIN);
    assert.equal(tall.height, WIN.height - BUTTON_BAND);
  });

  it("resizes sideways to the window's edges, beyond the bar", () => {
    assert.equal(resizeRect(PANEL, 'w', -5000, 0, WIN, MIN).x, 0);
    assert.equal(right(resizeRect(PANEL, 'e', 5000, 0, WIN, MIN)), WIN.width);
  });
});

/**
 * Full screen changes the window under the panel twice: the screen on the way in, the page window on
 * the way out. Either way the panel is clamped to the window it is now in, header and toggle inside.
 */
describe('entering and leaving full screen', () => {
  const PAGE = viewportBounds(1280, 720);
  const SCREEN = viewportBounds(1920, 1080);

  it('keeps a panel placed in the page where it was on the larger screen', () => {
    const placed = { x: 900, y: 300, width: 300, height: 400 };
    assert.deepEqual(reclampRect(placed, SCREEN, true), placed);
  });

  it('pulls a panel moved to the screen’s far corner back into the page window', () => {
    const corner = moveRect({ x: 900, y: 300, width: 300, height: 400 }, 5000, 5000, SCREEN);
    const back = reclampRect(corner, PAGE, true);
    assert.equal(right(back), PAGE.width);
    assert.equal(bottom(back), PAGE.height);
    assert.ok(buttonOf(back).y >= 0);
  });

  it('pulls a collapsed toggle on the screen’s far corner back into the page window', () => {
    const corner = moveHiddenRect({ x: 900, y: 300, width: 300, height: 400 }, 5000, 5000, SCREEN);
    const button = buttonOf(reclampRect(corner, PAGE, false));
    assert.deepEqual(button, { x: PAGE.width - BUTTON_SIZE, y: PAGE.height - BUTTON_SIZE });
  });
});

describe('cursorFor', () => {
  it('shows the direction of each edge and corner', () => {
    assert.equal(cursorFor('n'), 'ns-resize');
    assert.equal(cursorFor('s'), 'ns-resize');
    assert.equal(cursorFor('e'), 'ew-resize');
    assert.equal(cursorFor('w'), 'ew-resize');
    assert.equal(cursorFor('nw'), 'nwse-resize');
    assert.equal(cursorFor('se'), 'nwse-resize');
    assert.equal(cursorFor('ne'), 'nesw-resize');
    assert.equal(cursorFor('sw'), 'nesw-resize');
  });
});
