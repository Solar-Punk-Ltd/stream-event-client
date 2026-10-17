import { Bee, PrivateKey, Topic } from '@ethersphere/bee-js';

import { waitFor } from './bee.ts';
import { localStack } from './deployment.ts';
import { epochChunkAddress, epochIdentifier, epochPointer, type EpochPointer, findLatestPointer } from './epochFeed.ts';
import { CHAT_TIMEOUT_MS, type Run } from './run.ts';

/** The parts of a device's published state the leak check reads: what a reader of the feed would recover. */
interface DeviceState {
  connectedApps: { appUrl: string; appSecret?: string }[];
  postageStamps: { batchID: { toString(): string } | string; signerKey?: { toString(): string } | string }[];
}

/**
 * The secrets a device's published state carries that a device-state feed should never hold: a connected site's app secret, from
 * which its chat and content keys derive, and a stamp's private signer key, which spends the batch. One line each, none
 * when the feed carries neither. This is the known Swarm ID issue's test: it should find nothing once the feed stops
 * publishing re-derivable secrets.
 */
export function deviceFeedLeaks(account: DeviceState): string[] {
  const leaks: string[] = [];
  for (const app of account.connectedApps) {
    if (app.appSecret) leaks.push(`app secret for ${app.appUrl}`);
  }
  for (const stamp of account.postageStamps) {
    const signer = typeof stamp.signerKey === 'string' ? stamp.signerKey : stamp.signerKey?.toString();
    if (signer)
      leaks.push(
        `stamp signer key for ${typeof stamp.batchID === 'string' ? stamp.batchID : stamp.batchID.toString()}`,
      );
  }
  return leaks;
}

/** The fork's names for the device-state feed's topic and for the label its owner key is derived under. */
const DEVICE_STATE_TOPIC_PREFIX = 'swarm-id-devstate-v1';
const BACKUP_KEY_LABEL = 'backup-key';
/** What a single-owner chunk holds before its span and payload: the identifier and the signature. */
const SOC_HEADER = 32 + 65;
const SPAN = 8;

/** What an outsider recovers from one device's state feed. */
interface DeviceFeedRead {
  deviceId: string;
  /** Whether the feed's newest pointer carries the key that opens the state it points at. */
  keyInPointer: boolean;
  /** The secrets inside the state, read with that key alone. Empty when the pointer carries no key. */
  secrets: string[];
}

/** What a device-state feed exposes, one line each, none when its pointers carry no key and so open nothing. */
export function deviceFeedExposure(reads: DeviceFeedRead[]): string[] {
  return reads.flatMap((read) => [
    ...(read.keyInPointer ? [`the pointer of device ${read.deviceId} carries the key to its state`] : []),
    ...read.secrets,
  ]);
}

/**
 * The feed's owner address. A reader who finds the feed on Swarm sees it on the feed's chunks. The kit has no
 * crawler, so it works the address out from the account key it opened, and that address is all it takes from the key.
 */
async function feedOwner(derivationKey: string): Promise<Uint8Array> {
  const { deriveSecret, deriveSwarmEncryptionKey } = (await import('@solarpunkltd/swarm-id/internal')) as {
    deriveSecret: (key: string, label: string) => Promise<string>;
    deriveSwarmEncryptionKey: (derivationKey: string) => Promise<string>;
  };
  const backupKey = await deriveSecret(await deriveSwarmEncryptionKey(derivationKey), BACKUP_KEY_LABEL);
  return new PrivateKey(backupKey).publicKey().address().toUint8Array();
}

/** The newest pointer of one device's state feed, read from Swarm with the topic and the owner alone. */
async function newestPointer(bee: Bee, topic: Uint8Array, owner: Uint8Array): Promise<EpochPointer | undefined> {
  const at = BigInt(Math.floor(Date.now() / 1000));
  return findLatestPointer(at, async (epoch) => {
    const chunk = await bee.chunk.download(epochChunkAddress(epochIdentifier(topic, epoch), owner));
    const length = Number(new DataView(chunk.buffer, chunk.byteOffset + SOC_HEADER, SPAN).getBigUint64(0, true));
    const pointer = epochPointer(chunk.slice(SOC_HEADER + SPAN, SOC_HEADER + SPAN + length));
    return pointer && pointer.timestamp <= at ? pointer : undefined;
  });
}

/**
 * Reads the account's device-state feeds from Swarm as anyone who finds their address can: the newest pointer of each
 * device's feed, the key taken from the pointer when it carries one, and with that key alone the state it points at,
 * searched for the secrets it should never hold. A pointer with no key opens nothing, which is the fixed state. A device
 * that has published nothing is left out, and the read throws when none has, which is no evidence either way.
 */
export async function readDeviceFeedAsOutsider(
  run: Run,
  derivationKey: string,
  accountId: string,
  deviceIds: string[],
): Promise<DeviceFeedRead[]> {
  if (!deviceIds.length) throw new Error('the account names no device, so there is no device feed to read');
  const bee = new Bee(localStack(run, 'reading the device feed').addresses.worker2);
  const owner = await feedOwner(derivationKey);
  // A device publishes its state to Swarm when it takes the write lease, which a drive purchase and a stamp pick do, so
  // the feed may not be there the instant the read runs.
  return waitFor(
    'a device of the account to publish a state pointer to Swarm',
    async () => {
      const reads: DeviceFeedRead[] = [];
      for (const deviceId of deviceIds) {
        const topic = Topic.fromString(`${DEVICE_STATE_TOPIC_PREFIX}:${accountId}:${deviceId}`).toUint8Array();
        const pointer = await newestPointer(bee, topic, owner);
        if (!pointer) continue;
        if (!pointer.key) {
          reads.push({ deviceId, keyInPointer: false, secrets: [] });
          continue;
        }
        const state = (await bee.data.download(`${pointer.address}${pointer.key}`)).toJSON() as DeviceState;
        reads.push({ deviceId, keyInPointer: true, secrets: deviceFeedLeaks(state) });
      }
      return reads.length ? reads : null;
    },
    { timeoutMs: CHAT_TIMEOUT_MS },
  ).catch((error: unknown) => {
    throw new Error(`no device feed could be read from Swarm, so it proves nothing: ${String(error)}`);
  });
}
