/**
 * The words of Connect and of the failure bar: what each part of the viewer and each kind of source is called,
 * and what a failing part says about its source. In the design's wording.
 */
import type { FeatureFailure, SwarmFeature } from '@/swarm/client';
import type { SourceType } from '@/swarm/sources';

export const PART_LABELS: Readonly<Record<SwarmFeature, string>> = {
  player: 'Video',
  'stream-list': 'Stream list',
  previews: 'Previews',
  chat: 'Chat history',
};

/** What a source's row says it is. */
export const KIND_LABELS: Readonly<Record<SourceType, string>> = {
  gateway: 'Gateway',
  'bee-node': 'Bee node',
  'weeb-3': 'Weeb3',
};

/** Each tile of Add source: its name, and the line under it. */
export const ADD_TILES: Readonly<Record<SourceType, { readonly name: string; readonly line: string }>> = {
  gateway: { name: 'Gateway', line: 'A Swarm gateway at an https address' },
  'bee-node': { name: 'My Bee node', line: 'On this computer or at an https address' },
  'weeb-3': { name: 'Weeb3', line: 'A Swarm node in this browser tab' },
};

/** Each add view's title and its button. */
export const ADD_VIEWS: Readonly<Record<SourceType, { readonly title: string; readonly action: string }>> = {
  gateway: { title: 'Add a gateway', action: 'Add gateway' },
  'bee-node': { title: 'Add my Bee node', action: 'Add node' },
  'weeb-3': { title: 'Add Weeb3', action: 'Add Weeb3' },
};

/** Where an address field starts, a Bee node at the API port on this machine, as Swarm Desktop runs it. */
export const ADDRESS_PLACEHOLDERS: Readonly<Record<'gateway' | 'bee-node', string>> = {
  gateway: 'https://gateway.example.org',
  'bee-node': 'http://localhost:1633',
};

/** The tile of a kind a browser holds one of, once it holds it. */
export const ALREADY_ADDED = 'Already added';

/** Beside the node in this browser wherever a part but the video could pick it. */
export const VIDEO_ONLY = 'Video only for now';

/** On a source the deployment offers, in its settings. */
export const OFFERED_NOTE = 'Offered by this event. It cannot be changed or removed.';

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
