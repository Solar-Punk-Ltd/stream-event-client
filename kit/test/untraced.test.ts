import { describe, expect, it } from 'vitest';

import { UntracedSegments } from '../src/untraced.ts';

describe('UntracedSegments', () => {
  const recorder = () => {
    const calls: string[] = [];
    const segments = new UntracedSegments(
      async () => void calls.push('stop'),
      async () => void calls.push('start'),
    );
    return { calls, segments };
  };

  it('pauses the trace around a step and starts it again, and says nothing failed', async () => {
    const { calls, segments } = recorder();
    expect(await segments.run(async () => 'shown')).toBe('shown');
    expect(calls).toEqual(['stop', 'start']);
    expect(segments.failedInside).toBe(false);
  });

  it('remembers a failure inside, so the step that ran it takes no screenshot, until the next step clears it', async () => {
    const { calls, segments } = recorder();
    await expect(segments.run(() => Promise.reject(new Error('the field stayed')))).rejects.toThrow('stayed');
    expect(calls).toEqual(['stop', 'start']);
    expect(segments.failedInside).toBe(true);
    segments.clear();
    expect(segments.failedInside).toBe(false);
  });
});
