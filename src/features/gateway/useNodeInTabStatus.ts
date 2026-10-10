import { useCallback, useEffect, useMemo } from 'react';

import { useNodeStatus } from '@/shared/nodeInTabStatus';
import { createSwarmClient } from '@/swarm/createSwarmClient';
import type { ProviderStatus } from '@/swarm/provider';
import { gatewaySettingOf, type Source } from '@/swarm/sources';

import { onlyGateway } from './gatewayProbe';

/**
 * Where a node that runs in this tab is, kept current while its row shows. The node is started, since a
 * row showing it is a viewer who added it, and a page runs one, so this starts the same node the
 * video and the reads use.
 */
export function useNodeInTabStatus(source: Pick<Source, 'id' | 'type' | 'url'>): ProviderStatus {
  const { id, type, url } = source;
  const client = useMemo(() => createSwarmClient(onlyGateway(gatewaySettingOf({ id, type, url }))), [id, type, url]);
  useEffect(() => {
    client.start().catch(() => undefined);
  }, [client]);
  return useNodeStatus(useCallback(() => client.status(), [client]));
}
