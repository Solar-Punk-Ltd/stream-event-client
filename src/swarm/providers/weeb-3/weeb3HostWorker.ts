/**
 * The site's root worker, written by the build beside the page, which only loads weeb-3's own `/weeb-3/service.js`.
 * A worker may control the paths under its own folder, and wider only when its answer carries
 * `Service-Worker-Allowed`, which a host such as an ENS gateway never sends. Served from the root it may control the
 * whole site on any host that serves the site at its root. A site under a sub-path, such as a Bee node's
 * `/bzz/<reference>/`, stays out of reach, because weeb-3 uses fixed `/weeb-3/` paths. weeb-3 accepts a page controlled by another script that answers its forwarding protocol, and
 * this one answers it with weeb-3's own code.
 */
export const WEEB3_HOST_WORKER_URL = '/weeb-3-host.js';

/** How long the worker may take to install and claim the page, weeb-3's own limit for registering its worker. */
export const WEEB3_HOST_WORKER_DEADLINE_MS = 10_000;

/** The part of the browser's `navigator.serviceWorker` this needs. */
export type WorkerContainer = Pick<
  ServiceWorkerContainer,
  'controller' | 'register' | 'addEventListener' | 'removeEventListener'
>;

/**
 * Registers the root worker for the whole site unless it already controls the page, and answers whether it does once
 * it claims the page. weeb-3's worker claims every page it can as it activates, so a first visit needs no reload. A
 * registration of weeb-3's own worker for the whole site, which earlier versions made, is the same registration, so
 * this replaces its script. weeb-3 then finds the page controlled and registers nothing itself.
 */
export function controlPageWithHostWorker(
  container: WorkerContainer | undefined,
  origin: string,
  deadlineMs = WEEB3_HOST_WORKER_DEADLINE_MS,
): Promise<boolean> {
  if (!container) {
    return Promise.resolve(false);
  }
  const hostWorker = new URL(WEEB3_HOST_WORKER_URL, origin).href;
  const inControl = () => container.controller?.scriptURL === hostWorker;
  if (inControl()) {
    return Promise.resolve(true);
  }
  return new Promise((resolve) => {
    const finish = (controlled: boolean) => {
      clearTimeout(deadline);
      container.removeEventListener('controllerchange', changed);
      resolve(controlled);
    };
    const changed = () => {
      if (inControl()) {
        finish(true);
      }
    };
    const deadline = setTimeout(() => finish(inControl()), deadlineMs);
    container.addEventListener('controllerchange', changed);
    try {
      container
        .register(WEEB3_HOST_WORKER_URL, { scope: '/', updateViaCache: 'none' })
        .then(changed, () => finish(false));
    } catch {
      finish(false);
    }
  });
}

/** The browser's own container and origin, or none outside a browser. */
export function controlThisPage(): Promise<boolean> {
  if (typeof navigator === 'undefined' || typeof location === 'undefined') {
    return Promise.resolve(false);
  }
  return controlPageWithHostWorker(navigator.serviceWorker, location.origin);
}
