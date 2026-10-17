import { knownOutsideRequest } from './addresses.ts';

const GUARD_CONTROL = "the browser guard's control step, which asks for an outside address on purpose";

/** An actor's list of requests the browser guard stopped, in order, which only grows. */
interface Guarded {
  name: string;
  blocked: readonly string[];
}

/** A stopped request the release is known to make, and why it makes it. */
interface KnownOutside {
  actor: string;
  request: string;
  why: string;
}

/**
 * Hands over every request the browser guard stopped exactly once, by keeping a cursor per actor. A look after each
 * step catches what that step and the time since the last look made, and a last look after the browsers closed
 * catches what came after the last step, so no stopped request goes unjudged.
 */
export class OutsideRequests {
  private readonly actors: readonly Guarded[];
  private readonly controls: ReadonlySet<string>;
  private readonly cursors: number[];

  /** `controls` holds the requests the guard's own control step makes on purpose, as `<method> <url>`. */
  constructor(actors: readonly Guarded[], controls: ReadonlySet<string> = new Set()) {
    this.actors = actors;
    this.controls = controls;
    this.cursors = actors.map(() => 0);
  }

  /** What was stopped since the last look: the known ones with why, the unknown ones as `<actor>: <request>`. */
  since(): { known: KnownOutside[]; unknown: string[] } {
    const known: KnownOutside[] = [];
    const unknown: string[] = [];
    this.actors.forEach((actor, i) => {
      for (const request of actor.blocked.slice(this.cursors[i])) {
        const why = this.controls.has(request) ? GUARD_CONTROL : knownOutsideRequest(request);
        if (why === null) unknown.push(`${actor.name}: ${request}`);
        else known.push({ actor: actor.name, request, why });
      }
      this.cursors[i] = actor.blocked.length;
    });
    return { known, unknown };
  }
}
