// Prints what the first page load downloads in script and style, read from the built index.html,
// so a pull request can say how heavy the page is, and appends the same table to the GitHub step summary when
// GITHUB_STEP_SUMMARY is set. It reports and never fails a build on size, but it throws when the folder has no
// index.html.
import { appendFileSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';

const DIST = process.argv[2] ?? 'dist';

const html = readFileSync(join(DIST, 'index.html'), 'utf8');
const referenced = [...html.matchAll(/(?:src|href)="\.?\/?([^"]+\.(?:js|css))"/g)].map(([, path]) => path);
const files = [...new Set(referenced)];

const rows = files.map((path) => {
  const bytes = readFileSync(join(DIST, path));
  return { path, raw: statSync(join(DIST, path)).size, gzip: gzipSync(bytes).length };
});

const kB = (bytes) => `${(bytes / 1000).toFixed(1)} kB`;
const total = (key) => rows.reduce((sum, row) => sum + row[key], 0);

const lines = [
  '| First page load | Size | Gzipped |',
  '| --- | ---: | ---: |',
  ...rows.map((row) => `| ${row.path} | ${kB(row.raw)} | ${kB(row.gzip)} |`),
  `| **Total** | **${kB(total('raw'))}** | **${kB(total('gzip'))}** |`,
];

console.log(lines.join('\n'));

if (process.env.GITHUB_STEP_SUMMARY) {
  appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${lines.join('\n')}\n`);
}
