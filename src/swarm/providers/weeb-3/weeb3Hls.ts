/**
 * What weeb-3's own `import("hls.js")` loads in this app's build, and nothing else imports it. weeb-3 0.0.354001 has no
 * way to stop its player, which keeps loading segments for a video the viewer has left, so the build hands weeb-3 the
 * real hls.js with its player class made stoppable (`weeb3Playback.ts`). Being imported only by weeb-3, it is a chunk
 * that only weeb-3's chunk loads, never the first page load. `scripts/weeb3-files.mjs` points the import here.
 */
import RealHls from 'hls.js';

import { stoppableHls } from './weeb3Playback';

export * from 'hls.js';

const Hls = stoppableHls(RealHls);

export { Hls, Hls as default };
