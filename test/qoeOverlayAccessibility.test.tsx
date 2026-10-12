// @vitest-environment jsdom
import { createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { QoeOverlay } from '../src/features/player/overlays/qoe/QoeOverlay';
import { initialMetrics, type QoeMetrics } from '../src/features/player/overlays/qoe/useHlsQoeMetrics';
import { click, mount, type Mounted } from './helpers/dom';

let mounted: Mounted | null = null;

function render(metrics: QoeMetrics = initialMetrics()) {
  mounted = mount(createElement(QoeOverlay, { metrics, release: 'test-build' }));
}

function toggle(): HTMLButtonElement {
  return document.querySelector<HTMLButtonElement>('.qoe-overlay .qoe-btn')!;
}

/** The row whose label is `label`. */
function row(label: string): HTMLElement {
  const found = [...document.querySelectorAll<HTMLElement>('.qoe-overlay__row')].find(
    (r) => r.querySelector('.qoe-overlay__label')?.textContent === label,
  );
  if (!found) throw new Error(`no row ${label}`);
  return found;
}

beforeEach(() => {
  localStorage.clear();
  Object.defineProperty(document.documentElement, 'clientWidth', { configurable: true, value: 1024 });
  Object.defineProperty(document.documentElement, 'clientHeight', { configurable: true, value: 768 });
});

afterEach(() => {
  mounted?.unmount();
  mounted = null;
  document.body.innerHTML = '';
});

describe('the ladder rows', () => {
  it('render two rungs of the same height without a clash of keys', () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    render({
      ...initialMetrics(),
      ladder: [
        { height: 720, bitrateKbps: 2400, current: false, capped: false, unaffordable: false },
        { height: 720, bitrateKbps: 1800, current: false, capped: false, unaffordable: false },
      ],
    });
    const keyWarnings = errors.mock.calls.filter((call) => String(call[0]).includes('same key'));
    errors.mockRestore();

    expect(keyWarnings).toEqual([]);
    // The control: both rungs are on the panel.
    expect(document.body.textContent).toContain('2400 kbps');
    expect(document.body.textContent).toContain('1800 kbps');
  });
});

describe('the QoE panel for a screen reader and a keyboard', () => {
  it('names the toggle the same whether the panel is open or not, and says which by pressed', () => {
    render();
    expect(toggle().getAttribute('aria-label')).toBe('QoE metrics');
    expect(toggle().getAttribute('aria-pressed')).toBe('true');

    click(toggle());
    expect(toggle().getAttribute('aria-label')).toBe('QoE metrics');
    expect(toggle().getAttribute('aria-pressed')).toBe('false');
  });

  it('makes the panel a named region a keyboard can focus and scroll', () => {
    render();
    const panel = document.querySelector<HTMLElement>('.qoe-overlay__panel')!;
    expect(panel.getAttribute('role')).toBe('region');
    expect(panel.getAttribute('aria-label')).toBe('QoE metrics');
    expect(panel.tabIndex).toBe(0);
  });

  it('marks a bad value with a sign and words, not by its colour alone', () => {
    render({ ...initialMetrics(), droppedFrames: 4, rebufferingCount: 0 });

    const bad = row('Dropped Frames');
    expect(bad.classList.contains('qoe-overlay__row--bad')).toBe(true);
    expect(bad.querySelector('.qoe-overlay__flag')?.textContent).toBe('!out of range');
    // The control: a good value carries no mark.
    expect(row('Count').querySelector('.qoe-overlay__flag')).toBeNull();
  });
});
