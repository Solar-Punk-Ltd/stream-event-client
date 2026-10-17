import RealHls from 'hls.js';
import { describe, expect, it } from 'vitest';

import Weeb3Hls, { Hls } from '../../src/swarm/providers/weeb-3/weeb3Hls';
import { stoppableHls } from '../../src/swarm/providers/weeb-3/weeb3Playback';

describe('the hls.js weeb-3 is handed', () => {
  it("keeps what weeb-3's hls_loader.js reads off the class: its default config, its events and isSupported", () => {
    const Stoppable = stoppableHls(RealHls);

    expect(Stoppable.DefaultConfig).toBe(RealHls.DefaultConfig);
    expect(typeof Stoppable.DefaultConfig.bufferController).toBe('function');
    expect(Stoppable.Events).toBe(RealHls.Events);
    expect(Stoppable.Events.LEVEL_LOADED).toBe(RealHls.Events.LEVEL_LOADED);
    expect(Stoppable.isSupported).toBe(RealHls.isSupported);
    expect(Object.getPrototypeOf(Stoppable)).toBe(RealHls);
  });

  it('answers the same stoppable class as its default and as Hls', () => {
    expect(Weeb3Hls).toBe(Hls);
    expect(Weeb3Hls).not.toBe(RealHls);
    expect(Object.getPrototypeOf(Weeb3Hls)).toBe(RealHls);
    expect(Object.getOwnPropertyNames(Weeb3Hls.prototype)).toContain('stop');
  });
});
