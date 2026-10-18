/**
 * Live mode's standing accounts: the Swarm ID account an actor signs in to again on every run, instead of making one,
 * because a drive is bought once and kept (decision 2 B of the live mode plan) and Swarm ID cannot take a drive into
 * another account. The account's recovery phrase and password reach the kit only through the environment, the gate
 * checks them before a run without ever holding their values in what it writes, and the scenario's drive steps take the
 * account's drives in turn instead of buying one.
 */
import type { PreflightCheck } from './preflight.ts';
import type { Scenario } from './scenario.ts';
import type { Target } from './target.ts';

/** What signs an actor in to their standing account. Held in memory only, and a secret no evidence may hold. */
export interface StandingCredentials {
  phrase: string;
  password: string;
}

/** A standing account as a run holds it: what the target names of it, and what signs in to it. */
export interface StandingAccount {
  address: string;
  drives: string[];
  credentials: StandingCredentials;
}

export type StandingReading =
  | { state: 'missing'; variables: string[] }
  | { state: 'malformed'; problems: string[] }
  | { state: 'read'; account: StandingCredentials };

/** The word counts a BIP-39 recovery phrase comes in. */
const PHRASE_WORDS = [12, 15, 18, 21, 24];
/** The shortest password Swarm ID's access step takes. */
const MIN_PASSWORD_LENGTH = 8;

/**
 * The phrase's words with single spaces. A phrase kept as a numbered list, `1. word 2. word`, as a secret store may
 * keep it, loses its numbers, but only when they count up from 1 before every word.
 */
function phraseWords(value: string): string[] {
  const tokens = value.trim().split(/\s+/).filter(Boolean);
  const numbered =
    tokens.length % 2 === 0 &&
    tokens.length > 0 &&
    tokens.every((token, at) => at % 2 === 1 || new RegExp(`^${at / 2 + 1}[.)]$`).test(token));
  return numbered ? tokens.filter((_, at) => at % 2 === 1) : tokens;
}

/** The environment variables an actor's phrase and password are routed in by, never a file and never an argument. */
export function standingVariables(actor: string): { phrase: string; password: string } {
  const name = actor.toUpperCase();
  return { phrase: `KIT_${name}_PHRASE`, password: `KIT_${name}_PASSWORD` };
}

/**
 * An actor's phrase and password from `env`, or which variables are missing or not of the right shape. A value is
 * never part of an answer that is not `read`.
 */
export function readStandingAccount(env: Record<string, string | undefined>, actor: string): StandingReading {
  const variables = standingVariables(actor);
  const phrase = phraseWords(env[variables.phrase] ?? '').join(' ');
  const password = env[variables.password] ?? '';
  const missing = [...(phrase ? [] : [variables.phrase]), ...(password ? [] : [variables.password])];
  if (missing.length) return { state: 'missing', variables: missing };
  const words = phrase.split(' ');
  const problems = [
    ...(PHRASE_WORDS.includes(words.length) && words.every((word) => /^[a-z]+$/.test(word))
      ? []
      : [`${variables.phrase} is not a recovery phrase of 12 to 24 lower-case words`]),
    ...(password.length >= MIN_PASSWORD_LENGTH
      ? []
      : [`${variables.password} is shorter than ${MIN_PASSWORD_LENGTH} characters, the least Swarm ID takes`]),
  ];
  if (problems.length) return { state: 'malformed', problems };
  return { state: 'read', account: { phrase, password } };
}

/** The actors a scenario buys a drive for, whom live mode signs in to their standing account and its drives. */
export function standingActorsOf(scenario: Pick<Scenario, 'steps'>): string[] {
  const actors = scenario.steps.filter((step) => step.verb === 'buy-drive' && step.actor).map((step) => step.actor!);
  return [...new Set(actors)];
}

/** How a run gets the variables: in its environment from the operator's secret store, never typed or in a file. */
const runWith = (variables: string[]) =>
  `Run pnpm kit live run <scenario> --target <file> with ${variables.join(' and ')} in its environment, routed in by the operator's secret store so neither is typed or written to a file`;

/** Every check the standing-account part of the live gate makes, two for each actor. Any one not ok refuses the run. */
export function judgeStandingGate(
  readings: Record<string, StandingReading>,
  standing: Target['standing'],
): PreflightCheck[] {
  return Object.entries(readings).flatMap(([actor, reading]) => {
    const variables = standingVariables(actor);
    const named = standing.find((account) => account.actor === actor);
    return [
      {
        name: `standing account ${actor}`,
        ok: reading.state === 'read',
        detail:
          reading.state === 'missing'
            ? `${reading.variables.join(' and ')} ${reading.variables.length > 1 ? 'are' : 'is'} not set, and this scenario signs ${actor} in to a standing account. ${runWith([variables.phrase, variables.password])}`
            : reading.state === 'malformed'
              ? reading.problems.join(', ')
              : `read from ${variables.phrase} and ${variables.password}`,
      },
      {
        name: `standing target ${actor}`,
        ok: Boolean(named),
        detail: named
          ? `${actor} signs in to ${named.address}, with ${named.drives.length} drive${named.drives.length > 1 ? 's' : ''}`
          : `the target names no standing account for ${actor}, with its address and its drives`,
      },
    ];
  });
}

/** The standing accounts a run holds, one for each actor whose reading is read and whom the target names. */
export function standingAccounts(
  readings: Record<string, StandingReading>,
  standing: Target['standing'],
): Map<string, StandingAccount> {
  const accounts = new Map<string, StandingAccount>();
  for (const [actor, reading] of Object.entries(readings)) {
    const named = standing.find((account) => account.actor === actor);
    if (reading.state === 'read' && named) {
      accounts.set(actor, { address: named.address, drives: named.drives, credentials: reading.account });
    }
  }
  return accounts;
}

/** The secrets of the run's standing accounts, by name, for the evidence search. */
export function standingSecrets(accounts: Map<string, StandingAccount>): Record<string, string> {
  return Object.fromEntries(
    [...accounts].flatMap(([actor, { credentials }]) => [
      [`${actor}'s recovery phrase`, credentials.phrase],
      [`${actor}'s password`, credentials.password],
    ]),
  );
}

/** The standing drive an actor's next drive step takes: the first in the target's order the run has not used. */
export function nextStandingDrive(actor: string, drives: string[], used: string[]): string {
  const next = drives.find((drive) => !used.includes(drive));
  if (!next)
    throw new Error(`${actor}'s standing account has no drive left for this step, and live mode never buys one`);
  return next;
}
