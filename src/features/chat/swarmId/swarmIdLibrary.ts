import { SwarmIdClient as LibraryClient } from '@solarpunkltd/swarm-id';

import type { SwarmIdClient, SwarmIdClientOptions } from './swarmIdClient';

/** The library's frame draws a sign-in button of its own. The viewer draws its own, so the frame stays out of sight. */
const FRAME_CONTAINER_ID = 'swarm-id-frame';

function frameContainer(): HTMLElement {
  const found = document.getElementById(FRAME_CONTAINER_ID);
  if (found) {
    return found;
  }
  const container = document.createElement('div');
  container.id = FRAME_CONTAINER_ID;
  container.hidden = true;
  container.setAttribute('aria-hidden', 'true');
  document.body.appendChild(container);
  return container;
}

/** The library refuses a site name outside 1 to 100 characters. */
const APP_NAME_MAX_LENGTH = 100;
const FALLBACK_APP_NAME = 'Swarm streams';

/**
 * The one place the viewer builds the library's client. Assigning it to our shape checks the two still agree, and
 * taking it down takes the container with it.
 */
export function createLibraryClient({
  url,
  appName,
  onConnectionChange,
  beeApiUrl,
}: SwarmIdClientOptions): SwarmIdClient {
  const container = frameContainer();
  const client: SwarmIdClient = new LibraryClient({
    iframeOrigin: url,
    metadata: { name: appName.trim().slice(0, APP_NAME_MAX_LENGTH) || FALLBACK_APP_NAME },
    popupMode: 'popup',
    containerId: container.id,
    onConnectionChange,
    ...(beeApiUrl === undefined ? {} : { beeApiUrl }),
  });
  return {
    initialize: () => client.initialize(),
    connect: () => client.connect(),
    disconnect: () => client.disconnect(),
    getChatKey: () => client.getChatKey(),
    setBeeApiUrl: (address) => client.setBeeApiUrl(address),
    stampChunk: (chunk) => client.stampChunk(chunk),
    getPostageBatch: () => client.getPostageBatch(),
    get connectionInfo() {
      return client.connectionInfo;
    },
    destroy() {
      client.destroy();
      container.remove();
    },
  };
}
