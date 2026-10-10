import type { Weeb3Package } from './weeb3Package';

/**
 * The one place weeb-3 is loaded from, as a chunk of its own that a page fetches only once a viewer
 * picks the node in this browser.
 */
export const loadWeeb3Package = (): Promise<Weeb3Package> => import('@lat-murmeldjur/weeb_3');
