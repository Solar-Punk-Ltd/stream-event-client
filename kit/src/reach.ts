import { connect, createServer, type Server } from 'node:net';

import { docker, NETWORK, ownContainerId } from './docker.ts';

/**
 * Each loopback port the browser and the kit use, and the service and port on the kit's network behind it. On a
 * machine, compose publishes these ports on loopback itself. Inside a container, as a CI job
 * runs, the published ports are on the Docker host rather than here, so the kit joins the network and forwards each
 * port to its service, and every address the browser sees stays on loopback.
 */
const FORWARDS: ReadonlyArray<{ port: number; host: string; to: number }> = [
  { port: 9545, host: 'blockchain', to: 9545 },
  { port: 8546, host: 'ethereum', to: 8545 },
  { port: 1633, host: 'queen', to: 1633 },
  { port: 16331, host: 'worker-1', to: 1633 },
  { port: 16332, host: 'worker-2', to: 1633 },
  { port: 5500, host: 'swarm-id', to: 5500 },
  { port: 5501, host: 'swarm-id-strict', to: 5501 },
  { port: 4999, host: 'evil', to: 80 },
  { port: 5520, host: 'signaling', to: 5520 },
  { port: 3100, host: 'chat-server', to: 3000 },
  { port: 8080, host: 'gateway', to: 8080 },
  { port: 4180, host: 'viewer', to: 80 },
];

/** Bee's p2p ports, which compose publishes on loopback too but nothing of the kit reaches, so none is forwarded. */
const PUBLISHED_ONLY: ReadonlyArray<{ port: number; host: string }> = [
  { port: 1634, host: 'queen' },
  { port: 16341, host: 'worker-1' },
  { port: 16342, host: 'worker-2' },
];

let forwarding: Server[] | null = null;

/** The kit's ports whose service is not running and which another program already listens on, as `<part> <port>`. */
export async function busyPorts(running: ReadonlySet<string>): Promise<string[]> {
  const busy: string[] = [];
  for (const { port, host } of [...FORWARDS, ...PUBLISHED_ONLY]) {
    if (running.has(host)) continue;
    const free = await new Promise<boolean>((resolve) => {
      const server = createServer();
      server.once('error', () => resolve(false));
      server.listen(port, '127.0.0.1', () => server.close(() => resolve(true)));
    });
    if (!free) busy.push(`${host} ${port}`);
  }
  return busy;
}

/**
 * Makes the stack reachable on loopback from this process. Does nothing on a machine. In a container it joins the
 * kit's network, which must exist, so it is called after the first service is up, and starts the forwarders once.
 */
export async function reachStack(): Promise<void> {
  const self = ownContainerId();
  if (!self || forwarding) return;
  const joined = docker(['network', 'connect', NETWORK, self], { allowFailure: true });
  if (joined.status !== 0 && !/already exists/.test(joined.stderr)) {
    throw new Error(`could not join ${NETWORK}: ${joined.stderr}`);
  }
  forwarding = await Promise.all(
    FORWARDS.map(
      ({ port, host, to }) =>
        new Promise<Server>((resolve, reject) => {
          const server = createServer((inbound) => {
            const outbound = connect(to, host);
            inbound.pipe(outbound).pipe(inbound);
            inbound.on('error', () => outbound.destroy());
            outbound.on('error', () => inbound.destroy());
          });
          server.once('error', reject);
          server.listen(port, '127.0.0.1', () => resolve(server.unref()));
        }),
    ),
  );
}

/** Stops the forwarders and leaves the network, so `kit down` can remove it. */
export function leaveStack(): void {
  const self = ownContainerId();
  for (const server of forwarding ?? []) server.close();
  forwarding = null;
  if (self) docker(['network', 'disconnect', '-f', NETWORK, self], { allowFailure: true });
}
