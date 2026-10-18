import { EventEmitter } from 'node:events';

import { describe, expect, it } from 'vitest';

import { closeWithin, OpenRequests } from '../src/closeActor.ts';

const request = (url: string) => ({ method: () => 'GET', url: () => url });

describe('OpenRequests', () => {
  it('lists the requests that started and neither finished nor failed', () => {
    const context = new EventEmitter();
    const open = OpenRequests.of(context);
    const done = request('https://a.example.com/done.js');
    const failed = request('https://a.example.com/failed.js');
    const hanging = request('https://a.example.com/hanging.m3u8');
    for (const each of [done, failed, hanging]) context.emit('request', each);
    context.emit('requestfinished', done);
    context.emit('requestfailed', failed);
    expect(open.list()).toEqual(['GET https://a.example.com/hanging.m3u8']);
  });
});

describe('closeWithin', () => {
  it('says closed when the close ends inside its deadline', async () => {
    expect(await closeWithin(async () => undefined, 1_000)).toBe('closed');
  });

  it('says timed out, and does not wait on, a close that never ends', async () => {
    const never = () => new Promise<void>(() => undefined);
    expect(await closeWithin(never, 10)).toBe('timed out');
  });

  it('says closed when the close throws, since the context is gone either way', async () => {
    expect(
      await closeWithin(async () => {
        throw new Error('Target closed');
      }, 1_000),
    ).toBe('closed');
  });
});
