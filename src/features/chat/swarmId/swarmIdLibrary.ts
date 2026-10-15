import { SwarmIdClient as LibraryClient } from '@solarpunkltd/swarm-id';

import type { SwarmIdClient, SwarmIdClientOptions } from './swarmIdClient';

/** The library refuses a site name outside 1 to 100 characters. */
const APP_NAME_MAX_LENGTH = 100;
const FALLBACK_APP_NAME = 'Swarm streams';

/** The one place the viewer builds the library's client. Assigning it to our shape checks the two still agree. */
export function createLibraryClient({
  url,
  appName,
  onConnectionChange,
  beeApiUrl,
}: SwarmIdClientOptions): SwarmIdClient {
  const client: SwarmIdClient = new LibraryClient({
    iframeOrigin: url,
    metadata: { name: appName.trim().slice(0, APP_NAME_MAX_LENGTH) || FALLBACK_APP_NAME },
    popupMode: 'popup',
    onConnectionChange,
    ...(beeApiUrl === undefined ? {} : { beeApiUrl }),
  });
  return {
    initialize: () => client.initialize(),
    mountButton: (container, options) => client.mountButton(container, options),
    disconnect: () => client.disconnect(),
    getChatKey: () => client.getChatKey(),
    setBeeApiUrl: (address) => client.setBeeApiUrl(address),
    stampChunk: (chunk) => client.stampChunk(chunk),
    getPostageBatch: () => client.getPostageBatch(),
    get connectionInfo() {
      return client.connectionInfo;
    },
    destroy: () => client.destroy(),
  };
}
