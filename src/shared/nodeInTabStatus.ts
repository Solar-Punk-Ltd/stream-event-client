import { useEffect, useState } from 'react';

import type { DownloadProgress, ProviderStatus } from '@/swarm/provider';

/*
 * How a node that runs in the viewer's tab is shown starting: the Sources screen's row and the watch
 * page's stage say the same words, read the same way.
 */

const peerCount = (peers: number) => `${peers} ${peers === 1 ? 'peer' : 'peers'}`;

const BYTES_PER_MB = 1_000_000;

/** How much of a download has arrived: a share of the whole where the server named it, the bytes otherwise. */
function downloadWords({ receivedBytes, totalBytes }: DownloadProgress): string {
  if (totalBytes !== null) {
    // A server that compresses the module names the compressed length, which the bytes received can pass.
    return `Downloading ${Math.min(100, Math.floor((receivedBytes / totalBytes) * 100))}%`;
  }
  return receivedBytes === 0 ? 'Downloading' : `Downloading ${(receivedBytes / BYTES_PER_MB).toFixed(1)} MB`;
}

/** The peers counted against the healthy count where the node names one, such as "88 of 200 peers". */
function peersWords(peers: number, healthyPeers: number | undefined): string {
  return healthyPeers === undefined ? peerCount(peers) : `${peers} of ${healthyPeers} peers`;
}

/**
 * Where the node in this browser is, in one line: downloading, starting, connecting, its peers once in
 * use, or failed. The count keeps climbing after the node is ready, and the line follows it.
 */
export function weeb3StatusWords({ state, peers = 0, download, healthyPeers }: ProviderStatus): string {
  switch (state) {
    case 'stopped':
      return 'Not started';
    case 'starting':
      if (download) {
        return downloadWords(download);
      }
      return peers === 0 ? 'Starting' : `Connecting, ${peersWords(peers, healthyPeers)}`;
    case 'ready':
      return peersWords(peers, healthyPeers);
    case 'failed':
      return 'Failed to start';
  }
}

/** The one short note shown beside the count while it is under the healthy one, or null. */
export function healthyPeersNote({ state, peers = 0, download, healthyPeers }: ProviderStatus): string | null {
  const counting = (state === 'starting' && !download) || state === 'ready';
  return counting && healthyPeers !== undefined && peers < healthyPeers
    ? `${healthyPeers} peers is the healthy target`
    : null;
}

/** How often a node's state is read again, often enough that a download or a peer count looks live. */
const STATUS_READ_MS = 500;

const sameStatus = (one: ProviderStatus, other: ProviderStatus) =>
  one.state === other.state &&
  one.peers === other.peers &&
  one.healthyPeers === other.healthyPeers &&
  one.download?.receivedBytes === other.download?.receivedBytes &&
  one.download?.totalBytes === other.download?.totalBytes;

/** A node's state, read again every {@link STATUS_READ_MS} while the component shows. */
export function useNodeStatus(read: () => ProviderStatus): ProviderStatus {
  const [status, setStatus] = useState(read);
  useEffect(() => {
    const update = () => {
      const next = read();
      setStatus((current) => (sameStatus(current, next) ? current : next));
    };
    update();
    const timer = setInterval(update, STATUS_READ_MS);
    return () => clearInterval(timer);
  }, [read]);
  return status;
}
