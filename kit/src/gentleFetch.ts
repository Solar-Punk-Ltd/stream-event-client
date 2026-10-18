/**
 * Live mode fetches Swarm ID's files itself, a few at a time, and asks again after a server error. The deployment's
 * Swarm ID site sits on bzz.link, which answers 500 to many of a burst of parallel fetches and 200 to every file fetched
 * one at a time, and a fresh browser context asks for Swarm ID's whole module graph at once. A visitor's warm browser
 * rarely meets this, a cold test browser always does. Every server error and every retry is counted, so the
 * deployment's fault is reported rather than hidden.
 */

import { existsSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';

/** The file in an actor's evidence folder where its fetcher's counts are written when the actor closes. */
export const SWARM_ID_FETCHES_FILE = 'swarm-id-fetches.json';
/** How many of one actor's fetches to the Swarm ID site may be in flight at once. */
export const SWARM_ID_IN_FLIGHT = 4;
/**
 * How long to wait before each further attempt after a server error or a network error, six attempts in all over 31 s.
 * Measured on bzz.link on 2026-10-18: once a burst overloads it, a file it answered 500 keeps answering 500 for 8 to 30
 * s, so a shorter series gives up while the site is still recovering.
 */
export const SWARM_ID_RETRY_DELAYS_MS = [1_000, 2_000, 4_000, 8_000, 16_000] as const;
/** Answers from here up are the server's own failure, and are asked again. */
const SERVER_ERROR = 500;

/** What one actor's fetches to the Swarm ID site met. */
export interface GentleCounts {
  /** Requests to the Swarm ID site, each counted once however many attempts it took. */
  requests: number;
  /** Attempts answered 500 or above. */
  serverErrors: number;
  /** Attempts that got no answer at all. */
  networkErrors: number;
  /** Attempts beyond each request's first. */
  retries: number;
  /** Requests that needed at least one retry. */
  filesRetried: number;
  /** Requests whose last attempt still failed, handed to the page as they failed. */
  stillFailed: number;
}

/** The part of Playwright's route the fetcher uses, so a test can hand it a fake. */
export interface GentleRoute<Response extends { status(): number }> {
  request(): { url(): string };
  fetch(options?: { maxRedirects?: number }): Promise<Response>;
  fulfill(options: { response: Response }): Promise<void>;
  fallback(): Promise<void>;
  abort(errorCode?: string): Promise<void>;
}

export interface GentleOptions {
  inFlight?: number;
  retryDelaysMs?: readonly number[];
  sleep?: (ms: number) => Promise<void>;
}

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function isAt(url: string, origin: string): boolean {
  try {
    return new URL(url).origin === origin;
  } catch {
    return false;
  }
}

/** One actor's fetcher for the Swarm ID site's requests, used as a context route's handler. */
export class GentleFetcher<Response extends { status(): number }> {
  private readonly origin: string;
  private readonly inFlight: number;
  private readonly retryDelaysMs: readonly number[];
  private readonly sleep: (ms: number) => Promise<void>;
  private running = 0;
  private readonly waiting: (() => void)[] = [];
  private readonly tally: GentleCounts = {
    requests: 0,
    serverErrors: 0,
    networkErrors: 0,
    retries: 0,
    filesRetried: 0,
    stillFailed: 0,
  };

  constructor(origin: string, options: GentleOptions = {}) {
    this.origin = new URL(origin).origin;
    this.inFlight = options.inFlight ?? SWARM_ID_IN_FLIGHT;
    this.retryDelaysMs = options.retryDelaysMs ?? SWARM_ID_RETRY_DELAYS_MS;
    this.sleep = options.sleep ?? wait;
  }

  get counts(): GentleCounts {
    return { ...this.tally };
  }

  /**
   * Fetches a Swarm ID request, asking again after a server error or a network error, and hands the page the last
   * answer, so a file that never loads still fails. Any other request goes on to the next route.
   */
  handle = async (route: GentleRoute<Response>): Promise<void> => {
    if (!isAt(route.request().url(), this.origin)) return route.fallback();
    this.tally.requests++;
    await this.slot();
    let last: Response | null = null;
    try {
      for (let attempt = 0; attempt <= this.retryDelaysMs.length; attempt++) {
        if (attempt > 0) {
          this.tally.retries++;
          if (attempt === 1) this.tally.filesRetried++;
          await this.sleep(this.retryDelaysMs[attempt - 1]!);
        }
        // The browser follows a redirect itself, so a page keeps the address its relative links resolve against.
        last = await route.fetch({ maxRedirects: 0 }).catch(() => null);
        if (last === null) this.tally.networkErrors++;
        else if (last.status() >= SERVER_ERROR) this.tally.serverErrors++;
        else break;
      }
    } finally {
      this.release();
    }
    if (last === null || last.status() >= SERVER_ERROR) this.tally.stillFailed++;
    // The page or its context may have closed while the fetch ran, and then nothing waits for the answer.
    await (last === null ? route.abort('failed') : route.fulfill({ response: last })).catch(() => undefined);
  };

  private async slot(): Promise<void> {
    if (this.running < this.inFlight) {
      this.running++;
      return;
    }
    await new Promise<void>((resolve) => this.waiting.push(resolve));
  }

  private release(): void {
    const next = this.waiting.shift();
    if (next) next();
    else this.running--;
  }
}

/** Each actor's counts, by the actor's folder name, from the folders that have them. */
export function readSwarmIdFetches(actorDirs: string[]): Record<string, GentleCounts> {
  const byActor: Record<string, GentleCounts> = {};
  for (const dir of actorDirs) {
    const file = join(dir, SWARM_ID_FETCHES_FILE);
    if (existsSync(file)) byActor[basename(dir)] = JSON.parse(readFileSync(file, 'utf8')) as GentleCounts;
  }
  return byActor;
}

export type SwarmIdFetchFinding = GentleCounts & {
  byActor: Record<string, GentleCounts>;
  cause?: string;
};

const COUNTED = ['requests', 'serverErrors', 'networkErrors', 'retries', 'filesRetried', 'stillFailed'] as const;

/**
 * What the Swarm ID site's answers cost a live run, summed over its actors and for each, so its server errors stay
 * seen though the retries hid them from the page. A failed run that met any also names the likely cause.
 */
export function swarmIdFetchFinding(
  passed: boolean,
  byActor: Record<string, GentleCounts>,
): SwarmIdFetchFinding | null {
  const all = Object.values(byActor);
  if (all.length === 0) return null;
  const sum = (key: (typeof COUNTED)[number]) => all.reduce((total, counts) => total + counts[key], 0);
  const totals = Object.fromEntries(COUNTED.map((key) => [key, sum(key)])) as unknown as GentleCounts;
  const met = totals.serverErrors + totals.networkErrors > 0;
  return {
    ...totals,
    byActor,
    ...(!passed && met
      ? {
          cause:
            "Swarm ID's site answered its own files with 500 and up or not at all, which bzz.link does under parallel load, so the failure may be the deployment's address for Swarm ID and not the release",
        }
      : {}),
  };
}
