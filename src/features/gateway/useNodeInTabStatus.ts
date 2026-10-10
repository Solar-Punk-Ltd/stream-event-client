import { useCallback, useMemo } from 'react';

import { useNodeStatus } from '@/shared/nodeInTabStatus';
import { createSwarmClient } from '@/swarm/createSwarmClient';
import type { ProviderStatus } from '@/swarm/provider';
import { gatewaySettingOf, type Source } from '@/swarm/sources';

import { onlyGateway } from './gatewayProbe';

/**
 * Where a node that runs in this tab is, kept current while its row shows. Showing it starts nothing:
 * the node runs while the video reads from it or while the viewer is adding it.
 */
export function useNodeInTabStatus(source: Pick<Source, 'id' | 'type' | 'url'>): ProviderStatus {
  const { id, type, url } = source;
  const client = useMemo(() => createSwarmClient(onlyGateway(gatewaySettingOf({ id, type, url }))), [id, type, url]);
  return useNodeStatus(useCallback(() => client.status(), [client]));
}
