/**
 * The words Connect and the failure bar share: what each part of the viewer is called, and what a failing
 * part says about its source.
 */
import type { FeatureFailure, SwarmFeature } from '@/swarm/client';

export const PART_LABELS: Readonly<Record<SwarmFeature, string>> = {
  player: 'Video',
  'stream-list': 'Stream list',
  previews: 'Previews',
  chat: 'Chat history',
};

const seconds = (ms: number) => Math.max(1, Math.round(ms / 1000));

/** The bar's first line, such as "Video cannot load from Event gateway." */
export function failureTitle(feature: SwarmFeature, sourceName: string): string {
  return `${PART_LABELS[feature]} cannot load from ${sourceName}.`;
}

/** Why, in one short sentence, such as "No answer for 12 s." */
export function failureReason({ cause, forMs }: Pick<FeatureFailure, 'cause' | 'forMs'>): string {
  switch (cause.kind) {
    case 'no-answer':
      return `No answer for ${seconds(forMs)} s.`;
    case 'status':
      return `It answers with an error (HTTP ${cause.status}).`;
    case 'rate-limited':
      return 'It asks to be asked less often.';
    case 'unsupported':
      return 'It cannot read this part.';
  }
}
