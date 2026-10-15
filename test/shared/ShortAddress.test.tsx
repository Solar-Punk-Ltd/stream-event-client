// @vitest-environment jsdom
import { createElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ShortAddress } from '../../src/shared/components/Address/ShortAddress';
import { fullAddress, shortAddress } from '../../src/shared/components/Address/addressText';
import { button, click, type Mounted, mount, queryButton, settle } from '../helpers/dom';

const ADDRESS = '0d7f5b2e9c8a41f3d6b0e7a2c94f1d8b3e6aab12';
const LABEL = 'public address';
const SIGNATURE = `0x${'ab'.repeat(32)}${'cd'.repeat(32)}1b`;

describe('shortAddress', () => {
  it('keeps 0x and the first and last four hex digits, with or without the 0x it was given', () => {
    expect(shortAddress(ADDRESS)).toBe('0x0d7f…ab12');
    expect(shortAddress(`0x${ADDRESS}`)).toBe('0x0d7f…ab12');
    expect(shortAddress(SIGNATURE)).toBe('0xabab…cd1b');
  });

  it('leaves a value too short to shorten whole', () => {
    expect(shortAddress('0x12345678')).toBe('0x12345678');
    expect(shortAddress('123456789')).toBe('0x123456789');
  });

  it('spells the full form with one 0x', () => {
    expect(fullAddress(ADDRESS)).toBe(`0x${ADDRESS}`);
    expect(fullAddress(`0x${ADDRESS}`)).toBe(`0x${ADDRESS}`);
  });
});

describe('ShortAddress', () => {
  let mounted: Mounted | null = null;

  afterEach(() => {
    mounted?.unmount();
    mounted = null;
    document.body.innerHTML = '';
    vi.unstubAllGlobals();
  });

  const value = () => document.querySelector('.short-address-value');

  it('shows the short form, and a press shows the full form with a copy button beside it', () => {
    mounted = mount(createElement(ShortAddress, { value: ADDRESS, label: LABEL }));
    const toggle = button('0x0d7f…ab12');
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(queryButton('Copy the public address')).toBeNull();

    click(toggle);
    expect(value()?.textContent).toBe(`0x${ADDRESS}`);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(queryButton('Copy the public address')).not.toBeNull();

    click(toggle);
    expect(value()?.textContent).toBe('0x0d7f…ab12');
    expect(queryButton('Copy the public address')).toBeNull();
  });

  it('copies the full form', async () => {
    const writeText = vi.fn(() => Promise.resolve());
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    mounted = mount(createElement(ShortAddress, { value: ADDRESS, label: LABEL }));
    click(button('0x0d7f…ab12'));
    click(button('Copy the public address'));
    await settle();

    expect(writeText).toHaveBeenCalledWith(`0x${ADDRESS}`);
    expect(button('Copy the public address').textContent).toBe('Copied');
  });

  it('selects the full form for copying by hand when the browser refuses the clipboard', async () => {
    vi.stubGlobal('navigator', { clipboard: { writeText: () => Promise.reject(new Error('denied')) } });
    mounted = mount(createElement(ShortAddress, { value: ADDRESS, label: LABEL }));
    click(button('0x0d7f…ab12'));
    click(button('Copy the public address'));
    await settle();

    expect(window.getSelection()?.toString()).toBe(`0x${ADDRESS}`);
    expect(button('Copy the public address').textContent).toBe('Copy');
  });

  it('selects the full form when the browser has no clipboard at all', async () => {
    vi.stubGlobal('navigator', {});
    mounted = mount(createElement(ShortAddress, { value: ADDRESS, label: LABEL }));
    click(button('0x0d7f…ab12'));
    click(button('Copy the public address'));
    await settle();

    expect(window.getSelection()?.toString()).toBe(`0x${ADDRESS}`);
  });
});
