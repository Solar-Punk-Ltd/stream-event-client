import { SwarmClient } from '../../src/swarm/client';
import { BeeHttpProvider } from '../../src/swarm/providers/bee-http/beeHttpProvider';

// A client on one Bee gateway that the page under test only asks for URLs, so it is never fetched through.
export function gatewaySwarm(baseUrl: string): SwarmClient {
  return new SwarmClient({ chosen: { id: 'gateway', provider: new BeeHttpProvider({ baseUrl }) } });
}
