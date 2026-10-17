// Installs the libraries the kit packed over the versions this package's own lockfile names, inside an image build.
// Only the libraries the package already depends on are installed, so one set of tarballs serves every image. Run as
// `node /libraries/install.mjs` in the package's folder, with the kit's manifest beside this file.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const here = import.meta.dirname;
const manifest = JSON.parse(readFileSync(join(here, 'manifest.json'), 'utf8'));
const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
const wanted = Object.entries(manifest.libraries).filter(([name]) => pkg.dependencies?.[name]);
for (const [name, { file }] of wanted) console.log(`libraries: ${name} from ${file}`);
if (wanted.length) {
  execFileSync('pnpm', ['add', ...wanted.map(([, { file }]) => join(here, file))], { stdio: 'inherit' });
}
