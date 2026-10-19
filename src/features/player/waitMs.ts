/**
 * The wait the player ships with, named so that something can run it.
 *
 * Kept out of an inline default parameter, which would be the one code path every backoff test
 * injects over, so a default that returned immediately would leave the whole suite green while a page
 * of players hammered a gateway that was already down.
 */
export function waitMs(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
