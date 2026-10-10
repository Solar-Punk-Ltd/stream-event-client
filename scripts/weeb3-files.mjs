/**
 * The files of weeb-3, the Swarm node that runs in a viewer's browser, served under /weeb-3/ beside the page.
 *
 * The page's own code loads the package as a chunk of the bundle. What it starts then fetches the rest by these fixed
 * paths: its service worker at /weeb-3/service.js, its shared worker at /weeb-3/worker.js, which imports weeb_3.js and
 * its snippets beside it, and the WebAssembly module. So the build copies them out of the installed package, and the
 * dev and preview servers serve the service worker with the header that lets it control the whole site.
 *
 * Until the package is installed this copies nothing and says so once per build, and the page's stand-in reports the
 * node as failed, which sends the video to the next source.
 */
import { cpSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, extname, join, normalize } from 'node:path';

export const WEEB3_PACKAGE = '@lat-murmeldjur/weeb_3';

/** What the browser loads, as the package's own `files` lists it, without its type declarations. */
export const WEEB3_FILES = ['weeb_3.js', 'weeb_3_bg.wasm', 'service.js', 'worker.js', 'snippets'];

const PREFIX = '/weeb-3/';
const SERVICE_WORKER = `${PREFIX}service.js`;
const TYPES = { '.js': 'text/javascript', '.wasm': 'application/wasm' };

/** The installed package's folder, or null while it is not installed. */
export function weeb3PackageFolder(root) {
  try {
    return dirname(createRequire(join(root, 'package.json')).resolve(`${WEEB3_PACKAGE}/service.js`));
  } catch {
    return null;
  }
}

/** Copies the package's browser files into `<outDir>/weeb-3/`. Answers whether there was a package to copy. */
export function copyWeeb3Files(packageFolder, outDir) {
  if (packageFolder === null) {
    return false;
  }
  const target = join(outDir, 'weeb-3');
  mkdirSync(target, { recursive: true });
  for (const file of WEEB3_FILES) {
    const from = join(packageFolder, file);
    if (existsSync(from)) {
      cpSync(from, join(target, file), { recursive: true });
    }
  }
  return true;
}

/** Sends the service worker's scope header, and in the dev server, which has no build, the files themselves. */
function middleware(packageFolder, servesFiles) {
  return (request, response, next) => {
    const path = (request.url ?? '').split('?')[0];
    if (!path.startsWith(PREFIX)) {
      return next();
    }
    if (path === SERVICE_WORKER) {
      response.setHeader('Service-Worker-Allowed', '/');
    }
    if (!servesFiles || packageFolder === null) {
      return next();
    }
    const relative = normalize(decodeURIComponent(path.slice(PREFIX.length)));
    const file = join(packageFolder, relative);
    if (relative.startsWith('..') || !WEEB3_FILES.includes(relative.split('/')[0]) || !existsSync(file)) {
      return next();
    }
    response.setHeader('Content-Type', TYPES[extname(file)] ?? 'application/octet-stream');
    response.end(readFileSync(file));
  };
}

/** The Vite plugin: the copy at build, and the files and header in the dev and preview servers. */
export function weeb3Files(root) {
  const packageFolder = weeb3PackageFolder(root);
  let logger = console;
  return {
    name: 'weeb-3-files',
    configResolved(config) {
      logger = config.logger;
    },
    configureServer(server) {
      server.middlewares.use(middleware(packageFolder, true));
    },
    configurePreviewServer(server) {
      server.middlewares.use(middleware(packageFolder, false));
    },
    writeBundle(options) {
      if (!copyWeeb3Files(packageFolder, options.dir)) {
        logger.warn(
          `weeb-3: ${WEEB3_PACKAGE} is not installed, so this build carries no /weeb-3/ files and the node in the ` +
            'browser cannot start. Add the package to package.json and build again.',
        );
      }
    },
  };
}
