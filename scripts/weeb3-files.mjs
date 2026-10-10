/**
 * The files of weeb-3, the Swarm node that runs in a viewer's browser, served under /weeb-3/ beside the page.
 *
 * The page's own code loads the package as a chunk of the bundle. What it starts then fetches the rest by these fixed
 * paths: its service worker at /weeb-3/service.js, its shared worker at /weeb-3/worker.js, which imports weeb_3.js and
 * its snippets beside it, and the WebAssembly module. So the build copies them out of the installed package, and the
 * dev and preview servers serve the service worker with the header that lets it control the whole site.
 *
 * A build without the package installed copies nothing and says so once.
 */
import { cpSync, existsSync, mkdirSync, readFileSync, statSync } from 'node:fs';
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

/**
 * The WebAssembly module's own size in bytes, or null without the package. The page counts its download
 * against it, because a server that compresses the module answers with no length, or the compressed one.
 */
export function wasmBytesOf(packageFolder) {
  if (packageFolder === null) {
    return null;
  }
  const file = join(packageFolder, 'weeb_3_bg.wasm');
  return existsSync(file) ? statSync(file).size : null;
}

/** How the package's page-side module names its WebAssembly module when it is handed none. */
const DEFAULT_WASM_URL = "new URL('weeb_3_bg.wasm', import.meta.url)";

/**
 * The package's own module with its default WebAssembly path pointing at the copy served under /weeb-3/,
 * or null when it names none. Written as `import.meta.url` it makes the bundler emit a second 2.2 MB copy
 * beside the bundle that nothing loads, since the page hands the module its bytes. The copy under
 * /weeb-3/ keeps the original line, which the shared worker resolves beside itself.
 */
export function withServedWasmPath(code) {
  return code.includes(DEFAULT_WASM_URL)
    ? code.replace(DEFAULT_WASM_URL, `new URL('${PREFIX}weeb_3_bg.wasm', self.location.origin)`)
    : null;
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
    let relative;
    try {
      relative = normalize(decodeURIComponent(path.slice(PREFIX.length)));
    } catch {
      return next();
    }
    const file = join(packageFolder, relative);
    if (relative.startsWith('..') || !WEEB3_FILES.includes(relative.split('/')[0]) || !existsSync(file)) {
      return next();
    }
    response.setHeader('Content-Type', TYPES[extname(file)] ?? 'application/octet-stream');
    response.end(readFileSync(file));
  };
}

/**
 * The Vite plugins: the package's module rewritten before the bundler reads its asset URLs, then the
 * copy at build, and the files and header in the dev and preview servers.
 */
export function weeb3Files(root) {
  const packageFolder = weeb3PackageFolder(root);
  const packageModule = packageFolder === null ? null : join(packageFolder, 'weeb_3.js');
  let logger = console;
  const rewrite = {
    name: 'weeb-3-wasm-path',
    enforce: 'pre',
    transform(code, id) {
      return id.split('?')[0] === packageModule ? withServedWasmPath(code) : null;
    },
  };
  return [
    rewrite,
    {
      name: 'weeb-3-files',
      config() {
        return { define: { __WEEB3_WASM_BYTES__: JSON.stringify(wasmBytesOf(packageFolder)) } };
      },
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
    },
  ];
}
