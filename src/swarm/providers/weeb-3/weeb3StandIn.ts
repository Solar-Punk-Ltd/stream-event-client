/**
 * Stands in for `@lat-murmeldjur/weeb_3` while the package is younger than the week this repository's
 * install waits for any release. It has the package's shape and refuses to start, so a deployment that
 * switches weeb-3 on before the package is in the build sees the node fail to start and the page say
 * so, rather than a page that cannot load.
 */
import type { HlsStart, Weeb3Node } from './weeb3Package';

const NOT_IN_THIS_BUILD = 'weeb-3 is not part of this build yet';

export default async function init(): Promise<never> {
  throw new Error(NOT_IN_THIS_BUILD);
}

export class Weeb3No103 implements Weeb3Node {
  constructor() {
    throw new Error(NOT_IN_THIS_BUILD);
  }

  start(): void {}

  async connectionCount(): Promise<number> {
    return 0;
  }

  async attachStream(_media: HTMLMediaElement, _owner: string, _topic: string, _start: HlsStart): Promise<void> {
    throw new Error(NOT_IN_THIS_BUILD);
  }

  free(): void {}
}
