import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';

// React only runs effects inside act() when told it is in a test environment.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

export interface Mounted {
  root: Root;
  container: HTMLElement;
  render: (node: ReactNode) => void;
  unmount: () => void;
}

export function mount(node: ReactNode): Mounted {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  const render = (next: ReactNode) => act(() => root.render(next));
  render(node);
  return { root, container, render, unmount: () => act(() => root.unmount()) };
}

/** Lets timers of zero delay and settled promises run, then applies what they changed. */
export async function settle(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

function accessibleName(element: Element): string {
  return (element.getAttribute('aria-label') ?? element.textContent ?? '').trim();
}

function buttons(): HTMLButtonElement[] {
  return [...document.querySelectorAll('button')];
}

export function queryButton(name: string | RegExp): HTMLButtonElement | null {
  return (
    buttons().find((button) =>
      typeof name === 'string' ? accessibleName(button) === name : name.test(accessibleName(button)),
    ) ?? null
  );
}

export function button(name: string | RegExp): HTMLButtonElement {
  const found = queryButton(name);
  if (!found) {
    throw new Error(`no button named ${String(name)} among: ${buttons().map(accessibleName).join(' | ')}`);
  }
  return found;
}

export function click(element: Element): void {
  act(() => {
    element.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
}

export function input(label: string): HTMLInputElement {
  const found = document.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`);
  if (!found) {
    throw new Error(`no input labelled ${label}`);
  }
  return found;
}

/** Sets a value the way typing does, through the setter React listens behind. */
export function type(element: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  act(() => {
    setter?.call(element, value);
    element.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

export function press(element: Element, key: string): void {
  act(() => {
    element.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
  });
}

export function text(): string {
  return document.body.textContent ?? '';
}

export function dialog(): HTMLElement | null {
  return document.querySelector('[role="dialog"]');
}

/** Settles until the check finds something, for what arrives through a dynamic import. */
export async function waitFor<T>(check: () => T | null | undefined, attempts = 50): Promise<T> {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const found = check();
    if (found) {
      return found;
    }
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
  }
  throw new Error('what was waited for never arrived');
}
