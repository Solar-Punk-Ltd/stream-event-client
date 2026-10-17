import { isLocalDevHost, nonLocalAddresses } from './addresses.ts';

/** Docker's memory below which the stack's nine containers and a browser are not worth starting. */
const MIN_MEMORY_BYTES = 4 * 1024 ** 3;
/** A stamp this full is refused, so a run never measures a stamp running out. */
const MAX_STAMP_USE = 0.8;
/** The local chain's id, 100 as Gnosis, since the apps resolve the Swarm contracts from it. */
const CHAIN_ID = '0x64';

export interface BeeReading {
  name: string;
  ready: boolean;
  peers: number;
}

export interface StampReading {
  name: string;
  usable: boolean;
  usedFraction: number;
  /**
   * A stamp whose writes all go to the chat inbox's one address. Bee's own stamper takes a new slot of that address's
   * bucket for every write, and a mutable batch wraps the bucket when it is full, so such a stamp reads full minutes
   * after its first write and keeps working. Only whether it is usable says anything about it.
   */
  inbox?: boolean;
}

/**
 * What the gate reads. A reading left out has not been taken yet, as before the stack is up, and is not judged, so
 * the same gate runs before `kit up` starts anything and before every scenario.
 */
export interface PreflightReadings {
  addresses: Record<string, string>;
  memoryBytes: number;
  /** The address of the Docker daemon the kit would start the stack on, as the current context names it. */
  dockerHost?: string;
  /** The kit's ports another program already listens on, as `<part> <port>`. */
  busyPorts?: string[];
  chainId?: string | null;
  bees?: BeeReading[];
  /** Peers each node needs: the others of the cluster, which on three nodes is all of them. */
  minPeers?: number;
  stamps?: StampReading[];
  /**
   * The chat server's `/health` status, and whether one of its heartbeats has come back through the inbox. It answers
   * 200 for a while after it starts before any has, so the status alone says nothing about the inbox.
   */
  chatServer?: { status: number | null; heartbeatBack: boolean };
  /**
   * An ENS lookup of a baked wallet on the kit's Ethereum chain, through the library Swarm ID and the viewer use. A
   * snapshot that lacks what the lookup touches answers no name, which is how a stale or broken bake shows.
   */
  ens?: { wallet: string; expected: string; found: string | null };
}

export interface PreflightCheck {
  name: string;
  ok: boolean;
  detail: string;
}

/**
 * Whether a daemon address is on this machine: a socket or a named pipe, or tcp to a local development host. The
 * stack's ports are published on the daemon's loopback, so on another machine the browser would reach nothing of it,
 * and anything the kit starts would run there.
 */
function isLocalDaemon(host: string): boolean {
  if (/^(unix|npipe):\/\//.test(host)) return true;
  try {
    const url = new URL(host);
    return url.protocol === 'tcp:' && isLocalDevHost(url.hostname);
  } catch {
    return false;
  }
}

/** Whether the Docker daemon the kit would use is on this machine, the one check every command that starts a container makes. */
export function daemonCheck(host: string): PreflightCheck {
  const local = isLocalDaemon(host);
  return {
    name: 'docker daemon',
    ok: local,
    detail: local ? 'on this machine' : `not on this machine: ${host || 'none named'}`,
  };
}

/** Every check the gate makes on the readings, in order. Any one that is not ok refuses the start. */
export function judgePreflight(readings: PreflightReadings): PreflightCheck[] {
  const checks: PreflightCheck[] = [];
  const add = (name: string, ok: boolean, detail: string) => checks.push({ name, ok, detail });

  const outside = nonLocalAddresses(readings.addresses);
  add(
    'local addresses',
    outside.length === 0,
    outside.length ? `not a local development host: ${outside.join(', ')}` : 'every address is local',
  );
  add(
    'memory',
    readings.memoryBytes >= MIN_MEMORY_BYTES,
    `${(readings.memoryBytes / 1024 ** 3).toFixed(1)} GiB for Docker, ${MIN_MEMORY_BYTES / 1024 ** 3} GiB needed`,
  );
  if (readings.dockerHost !== undefined) checks.push(daemonCheck(readings.dockerHost));
  if (readings.busyPorts !== undefined) {
    const busy = readings.busyPorts;
    add('ports', busy.length === 0, busy.length ? `held by another program: ${busy.join(', ')}` : 'every port is free');
  }
  if (readings.chainId !== undefined) {
    add('chain', readings.chainId === CHAIN_ID, `chain id ${readings.chainId ?? 'not answered'}, ${CHAIN_ID} needed`);
  }
  const minPeers = readings.minPeers ?? 1;
  for (const bee of readings.bees ?? []) {
    add(
      `bee ${bee.name}`,
      bee.ready && bee.peers >= minPeers,
      `${bee.ready ? 'ready' : 'not ready'}, ${bee.peers} peers, ${minPeers} needed`,
    );
  }
  for (const stamp of readings.stamps ?? []) {
    const used = `${Math.round(stamp.usedFraction * 100)}% used`;
    add(
      `stamp ${stamp.name}`,
      stamp.usable && (stamp.inbox || stamp.usedFraction < MAX_STAMP_USE),
      `${stamp.usable ? 'usable' : 'not usable'}, ${stamp.inbox ? `${used} in the inbox's bucket, which wraps` : used}`,
    );
  }
  if (readings.ens) {
    const { wallet, expected, found } = readings.ens;
    add('ens', found === expected, `${wallet} reads as ${found ?? 'no name'}, ${expected} expected`);
  }
  if (readings.chatServer) {
    const { status, heartbeatBack } = readings.chatServer;
    add(
      'chat server',
      status === 200 && heartbeatBack,
      `/health answered ${status ?? 'nothing'}, ${heartbeatBack ? 'a heartbeat came back' : 'no heartbeat came back yet'}`,
    );
  }
  return checks;
}
