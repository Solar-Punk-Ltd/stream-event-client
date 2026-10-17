import type { Actor } from './actors.ts';
import type { Sent } from './chatFeed.ts';
import type { Deployment, LocalStack, SiteAddresses } from './deployment.ts';
import type { Step } from './scenario.ts';
import type { LiveDeployment } from './target.ts';
import type { TestWallet } from './wallet.ts';

/** What one scenario run holds while its steps run. A verb reads it and adds to it. */
export interface Run {
  id: string;
  addresses: SiteAddresses;
  deployment: Deployment;
  /** The local stack, null in live mode. A verb that needs it takes it through `localStack`. */
  local: LocalStack | null;
  /** The real deployment, null in local mode. */
  live: LiveDeployment | null;
  /**
   * The wallet that owns the target's ENS name, live only, its key read from the environment. Null locally, where the
   * snapshot's baked wallets stand in for it. Its key is a secret no evidence may hold.
   */
  ensWallet: TestWallet | null;
  actor(name: string): Actor;
  actors: Actor[];
  sent: Sent[];
  /** Secrets a page must never see, by name, gathered as the run makes them. Never written anywhere. */
  secrets: Map<string, string>;
  /** Requests to outside addresses a check makes on purpose to prove the browser guard, as `<method> <url>`. */
  guardControls: Set<string>;
  /** What each check found, written into the verdict. */
  findings: Record<string, unknown>;
  /** Checks that can only finish once every actor's browser is closed and its recording written. */
  afterClose: AfterClose[];
}

/** The part of a check that runs once the browsers closed, and the step it belongs to. */
export interface AfterClose {
  step: string;
  check: () => Promise<void>;
}

export type Verb = (run: Run, step: Step) => Promise<void>;

export const CHAT_TIMEOUT_MS = 60_000;
/**
 * How long `expect no-site-stamp` keeps watching after the viewer first says it has no stamp. A drive reaches an open
 * site's frame over the account bus within seconds, so a stamp given without a pick shows up well inside this.
 */
export const NO_STAMP_HOLD_MS = 20_000;
export const CHOOSE_STAMP = 'Choose a stamp in Swarm ID';

/** Fills in `{run}` in a step's text, so a scenario run twice on one stack never matches the first run's messages. */
export const expand = (run: Run, text: string) => text.replaceAll('{run}', run.id);
