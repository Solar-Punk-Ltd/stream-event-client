import { weeb3StatusWords } from '@/shared/nodeInTabStatus';
import type { Source } from '@/swarm/sources';

import { useNodeInTabStatus } from './useNodeInTabStatus';

import './NodeInTabProgress.scss';

function Weeb3Progress({ source }: { readonly source: Source }) {
  const status = useNodeInTabStatus(source);
  if (status.state === 'ready') {
    return null;
  }
  return (
    <p className="node-in-tab-progress" role="status">
      The Swarm node in this browser: {weeb3StatusWords(status)}
    </p>
  );
}

/**
 * How far the node in this browser has got, for a part that reads from it and waits for it: its download, its start
 * and its peers, until it is ready. Nothing for a part on any other source.
 */
export function NodeInTabProgress({ source }: { readonly source: Source | null }) {
  return source?.type === 'weeb-3' ? <Weeb3Progress source={source} /> : null;
}
