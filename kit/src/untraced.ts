/**
 * The stretches of a step that run with the trace paused, because a secret is typed, shown or handed back then. A step
 * that failed inside one may have left the secret on screen, so it is remembered until the next step clears it, and
 * that step takes no screenshot.
 */
export class UntracedSegments {
  private readonly pause: () => Promise<void>;
  private readonly resume: () => Promise<void>;
  private failed = false;

  constructor(pause: () => Promise<void>, resume: () => Promise<void>) {
    this.pause = pause;
    this.resume = resume;
  }

  /** Whether a stretch failed since the last `clear`. */
  get failedInside(): boolean {
    return this.failed;
  }

  clear(): void {
    this.failed = false;
  }

  async run<T>(step: () => Promise<T>): Promise<T> {
    await this.pause();
    try {
      return await step();
    } catch (error) {
      this.failed = true;
      throw error;
    } finally {
      await this.resume();
    }
  }
}
