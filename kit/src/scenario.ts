import { z } from 'zod';

/** How each actor's browser is started: plain, with third-party storage partitioned, or under a popup blocker. */
const BrowserProfile = {
  PLAIN: 'plain',
  PARTITIONED: 'partitioned',
  POPUP_BLOCKED: 'popup-blocked',
} as const;
export type BrowserProfile = (typeof BrowserProfile)[keyof typeof BrowserProfile];

/**
 * What an actor's browser starts with. `chatSource` picks the viewer's own Bee node for the chat history before the
 * first page load, as a browser that chose it earlier keeps it, because sending on one's own stamp needs a node of
 * one's own. The `connect-source` verb chooses one through Connect instead, as a person does.
 */
const actorSchema = z.strictObject({
  chatSource: z.enum(['gateway', 'bee']).default('gateway'),
});
export type ActorSettings = z.infer<typeof actorSchema>;

/** The verb every assertion goes through, whose first argument names the check. */
export const EXPECT = 'expect';

/** One line of a scenario: `<actor> <verb> [args] [key=value] [--option value]`, or `expect <check> [args]`. */
export interface Step {
  actor: string | null;
  verb: string;
  args: string[];
  options: Record<string, string>;
  line: string;
}

/**
 * A finding of the release a scenario reproduces, which keeps it red until the release fixes it: what it is and where
 * it is recorded, and the step whose failure is the finding's direct evidence. A failure anywhere else says nothing
 * about the finding.
 */
export interface Known {
  finding: string;
  failsAt: string;
}

/**
 * A limit a scenario passes with on purpose: a result the product gives by design that a reader might take for a
 * defect, named in plain words so the pass is never read as more than it is. Written into the verdict and the run's
 * line.
 */
interface Accepted {
  limit: string;
}

export interface Scenario {
  name: string;
  description: string;
  profile: BrowserProfile;
  actors: Record<string, ActorSettings>;
  steps: Step[];
  known?: Known;
  accepted?: Accepted;
}

const scenarioSchema = z.strictObject({
  name: z.string().regex(/^[a-z0-9-]+$/),
  description: z.string().default(''),
  profile: z.enum(Object.values(BrowserProfile) as [BrowserProfile, ...BrowserProfile[]]),
  actors: z.record(z.string().regex(/^[a-z]+$/), actorSchema),
  steps: z.array(z.string().min(1)).min(1),
  /** Unset for a scenario that must pass. */
  known: z.strictObject({ finding: z.string().min(1), failsAt: z.string().min(1) }).optional(),
  /** Set for a scenario that must pass and whose expected result is a limit of the product. */
  accepted: z.strictObject({ limit: z.string().min(1) }).optional(),
});

function words(line: string): string[] {
  const out: string[] = [];
  let i = 0;
  while (i < line.length) {
    if (line[i] === ' ') {
      i++;
      continue;
    }
    if (line[i] === '"') {
      const end = line.indexOf('"', i + 1);
      if (end < 0) throw new Error(`a quote is never closed in: ${line}`);
      out.push(line.slice(i + 1, end));
      i = end + 1;
      continue;
    }
    const end = line.indexOf(' ', i);
    out.push(line.slice(i, end < 0 ? line.length : end));
    i = end < 0 ? line.length : end;
  }
  return out;
}

/**
 * Reads one scenario line. Quoted text is one argument, `key=value` and `--key value` are options, and a `--flag` with
 * no value after it is the option `flag` set to `true`.
 */
export function parseStep(line: string): Step {
  const tokens = words(line.trim());
  const isExpect = tokens[0] === EXPECT;
  const actor = isExpect ? null : (tokens.shift() ?? null);
  const verb = tokens.shift();
  if (!verb) throw new Error(`a step names no verb: ${line}`);
  const args: string[] = [];
  const options: Record<string, string> = {};
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    const assignment = token.match(/^([a-z][a-z0-9-]*)=(.*)$/);
    if (token.startsWith('--')) {
      const next = tokens[i + 1];
      options[token.slice(2)] = next === undefined || next.startsWith('--') ? 'true' : tokens[++i];
    } else if (assignment) options[assignment[1]] = assignment[2];
    else args.push(token);
  }
  return { actor, verb, args, options, line };
}

/** Reads a scenario file's JSON, and refuses a step whose actor the scenario does not name. */
export function parseScenario(value: unknown): Scenario {
  const raw = scenarioSchema.parse(value);
  const steps = raw.steps.map(parseStep);
  for (const step of steps) {
    if (step.actor !== null && !(step.actor in raw.actors)) {
      throw new Error(`step "${step.line}" names ${step.actor}, who is not among the actors`);
    }
  }
  if (raw.known && raw.accepted) {
    throw new Error('a scenario is either known red or passes with an accepted limit, not both');
  }
  if (raw.known && !raw.steps.includes(raw.known.failsAt)) {
    throw new Error(`the known finding fails at "${raw.known.failsAt}", which is not one of the steps`);
  }
  return { ...raw, steps };
}

/** The steps whose verb, or whose check for an `expect`, is not registered, so a typo fails before anything runs. */
export function unknownVerbs(scenario: Scenario, verbs: ReadonlySet<string>, checks: ReadonlySet<string>): string[] {
  return scenario.steps
    .filter((step) => (step.verb === EXPECT ? !checks.has(step.args[0] ?? '') : !verbs.has(step.verb)))
    .map((step) => step.line);
}

/** How one scenario ended, for `kit test`: whether it passed, its known finding, and the step it failed at. */
export interface ScenarioResult {
  ok: boolean;
  known?: Known;
  /** The line of the first step that failed, or why the run stopped outside a step. */
  failedAt?: string;
}

/**
 * `kit test`'s exit: 0 when every scenario passed and every known one failed at its pinned step. A known scenario that
 * passes fails the suite too, since its finding may be fixed and the scenario should then be made one that must pass,
 * and so does one that failed elsewhere, since that failure is not the finding.
 */
export function suiteStatus(results: ReadonlyArray<ScenarioResult>): number {
  const holds = (result: ScenarioResult) =>
    result.known ? !result.ok && result.failedAt === result.known.failsAt : result.ok;
  return results.every(holds) ? 0 : 1;
}
