import { useEffect, useMemo, useState } from 'react';

import { createSwarmClient } from '@/swarm/createSwarmClient';
import type { ProviderStatus } from '@/swarm/provider';
import { gatewaySettingOf, type Source } from '@/swarm/sources';

import { onlyGateway } from './gatewayProbe';

/** How often a row reads its node's state again, often enough that a peer count looks live. */
const STATUS_READ_MS = 500;

const sameStatus = (one: ProviderStatus, other: ProviderStatus) =>
  one.state === other.state && one.peers === other.peers;

/**
 * Where a node that runs in this tab is, kept current while its row shows. The node is started, since a
 * row showing it is a viewer who added it, and a page runs one, so this starts the same node the
 * video and the reads use.
 */
export function useNodeInTabStatus(source: Pick<Source, 'id' | 'type' | 'url'>): ProviderStatus {
  const { id, type, url } = source;
  const client = useMemo(() => createSwarmClient(onlyGateway(gatewaySettingOf({ id, type, url }))), [id, type, url]);
  const [status, setStatus] = useState(() => client.status());

  useEffect(() => {
    client.start().catch(() => undefined);
    const read = () => {
      const next = client.status();
      setStatus((current) => (sameStatus(current, next) ? current : next));
    };
    read();
    const timer = setInterval(read, STATUS_READ_MS);
    return () => clearInterval(timer);
  }, [client]);

  return status;
}
