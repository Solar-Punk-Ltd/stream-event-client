/**
 * The status in the diagnostics a viewer copies: who answered each feature in the last minute, in words, from the
 * Swarm client's own counts. Pure, so it is only read when the diagnostics are copied.
 */
import type { AnswerKind } from '@/swarm/answers';
import type { FeatureActivity, SwarmFeature } from '@/swarm/client';

export const FEATURE_LABELS: Readonly<Record<SwarmFeature, string>> = {
  'stream-list': 'Stream list',
  player: 'Video',
  previews: 'Previews and pictures',
  chat: 'Chat',
};

const ANSWER_WORDS: Readonly<Record<AnswerKind, string>> = {
  content: 'served',
  'not-found': 'not there yet',
  'rate-limited': 'asked to slow down',
  unsupported: 'could not read',
  unavailable: 'failed',
  aborted: 'stopped',
};

export interface StatusRow {
  readonly feature: SwarmFeature;
  readonly label: string;
  /** Which provider the feature reads from. */
  readonly route: string;
  /** What answered in the last minute, or that nothing did. */
  readonly answered: string;
}

/** A provider's name as a viewer knows it, never its address. */
type NameOf = (providerId: string) => string;

/** The rows of the status view, one per feature, in the order the client lists them. */
export function statusRows(activity: readonly FeatureActivity[], nameOf: NameOf): StatusRow[] {
  return activity.map(({ feature, primary, answers }) => {
    const route = `Reads from ${nameOf(primary)}.`;
    if (answers.length === 0) {
      return { feature, label: FEATURE_LABELS[feature], route, answered: 'Nothing read in the last minute.' };
    }
    const byProvider = new Map<string, string[]>();
    for (const { provider, answer, count } of answers) {
      byProvider.set(provider, [...(byProvider.get(provider) ?? []), `${count} ${ANSWER_WORDS[answer]}`]);
    }
    const parts = [...byProvider].map(([provider, counts]) => `${nameOf(provider)}: ${counts.join(', ')}`);
    return { feature, label: FEATURE_LABELS[feature], route, answered: `In the last minute, ${parts.join('. ')}.` };
  });
}
