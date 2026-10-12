/**
 * The name a build carries into the page, which Copy diagnostics on the Sources screen reports: the release tag and
 * the short commit, such as `v1.7.0-rc.5 (1fcfbd4)`.
 *
 * Read in this order:
 * 1. `BUILD_TAG` and `BUILD_COMMIT` from the environment. The image workflow passes them as build arguments, because
 *    a Docker build has no `.git` to ask. A tag without a commit, or a commit without a tag, gives that one part. A
 *    value of the wrong shape stops the build rather than reaching the page.
 * 2. The git checkout the build runs in, named the way the streaming monorepo's `tools/release/version.mjs` names a
 *    build: the tag on the commit, an annotated one before a lightweight one and the newest first, else the nearest
 *    tag behind it and the commits past it (`v1.7.0-rc.5+3`), else the short commit alone, ended by `-dirty` when the
 *    tree holds uncommitted changes.
 * 3. Neither: `development build`.
 */
import { execFileSync } from 'node:child_process';
import { realpathSync } from 'node:fs';

export const DEVELOPMENT_BUILD = 'development build';

const SHORT_LENGTH = 7;
const TAG_NAME_MAX_LENGTH = 80;
const TAG_SHAPE = /^[A-Za-z0-9][A-Za-z0-9._+/-]*$/;
const COMMIT_SHAPE = /^[0-9a-f]{7,64}$/;

// What a git hook exports to point every git command at one repository. Inherited, it would make the build read
// that repository instead of the folder it was asked about.
const LOCATING_VARIABLES = [
  'GIT_DIR',
  'GIT_WORK_TREE',
  'GIT_INDEX_FILE',
  'GIT_COMMON_DIR',
  'GIT_OBJECT_DIRECTORY',
  'GIT_ALTERNATE_OBJECT_DIRECTORIES',
  'GIT_PREFIX',
  'GIT_NAMESPACE',
];

// The same rule as the monorepo's `tools/release/lib/tagName.mjs`: a name a page shows and a shell carries without
// quoting, and none of what git refuses in a ref name within that set.
function isSafeTagName(name) {
  return (
    typeof name === 'string' &&
    name.length > 0 &&
    name.length <= TAG_NAME_MAX_LENGTH &&
    TAG_SHAPE.test(name) &&
    !name.includes('..') &&
    !name.includes('//') &&
    !name.includes('/.') &&
    !name.endsWith('.') &&
    !name.endsWith('/') &&
    !name.split('/').some((part) => part.endsWith('.lock'))
  );
}

// Tag names git describe leaves out by character and by length. A nearest tag that still fails isSafeTagName gives
// the short commit instead.
const DESCRIBE_EXCLUDES = ['*[!A-Za-z0-9._+/-]*', '[!A-Za-z0-9]*', `${'?'.repeat(TAG_NAME_MAX_LENGTH + 1)}*`].flatMap(
  (pattern) => ['--exclude', pattern],
);

function gitIn(root) {
  const env = { ...process.env };
  for (const name of LOCATING_VARIABLES) delete env[name];
  return (args) => {
    try {
      return execFileSync('git', args, {
        cwd: root,
        env,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      }).trim();
    } catch {
      return null;
    }
  };
}

function label(base, short) {
  return short ? `${base} (${short})` : base;
}

function fromEnvironment(env) {
  const tag = env.BUILD_TAG || '';
  const commit = (env.BUILD_COMMIT || '').toLowerCase();
  if (!tag && !commit) return null;
  if (tag && !isSafeTagName(tag)) {
    throw new Error(`BUILD_TAG may hold only letters, digits and . _ + / -, at most ${TAG_NAME_MAX_LENGTH} characters`);
  }
  if (commit && !COMMIT_SHAPE.test(commit)) throw new Error('BUILD_COMMIT must be a commit id in hexadecimal');
  const short = commit.slice(0, SHORT_LENGTH);
  return tag ? label(tag, short) : short;
}

function tagAtHead(git) {
  const out = git([
    'for-each-ref',
    '--points-at=HEAD',
    '--sort=-creatordate',
    '--format=%(objecttype) %(refname:lstrip=2)',
    'refs/tags',
  ]);
  const tags = (out || '')
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const space = line.indexOf(' ');
      return { annotated: line.slice(0, space) === 'tag', name: line.slice(space + 1) };
    })
    .filter((tag) => isSafeTagName(tag.name));
  return (tags.find((tag) => tag.annotated) ?? tags[0])?.name ?? '';
}

function nearestTagAndDistance(git) {
  const nearest = git(['describe', '--tags', '--abbrev=0', ...DESCRIBE_EXCLUDES, 'HEAD']);
  if (!nearest || !isSafeTagName(nearest)) return '';
  const distance = git(['rev-list', '--count', `refs/tags/${nearest}..HEAD`]);
  return distance ? `${nearest}+${distance}` : '';
}

function fromCheckout(root) {
  const git = gitIn(root);
  const top = git(['rev-parse', '--show-toplevel']);
  if (!top || realpathSync(top) !== realpathSync(root)) return null;
  const commit = git(['rev-parse', '--verify', '--quiet', 'HEAD^{commit}']);
  if (!commit) return null;
  const short = commit.slice(0, SHORT_LENGTH);
  const tag = tagAtHead(git) || nearestTagAndDistance(git);
  const dirty = git(['status', '--porcelain', '--untracked-files=normal']) !== '';
  if (!tag) return dirty ? `${short}-dirty` : short;
  return label(dirty ? `${tag}-dirty` : tag, short);
}

/**
 * The label for a build of the checkout at `root`.
 *
 * @param {{ root: string, env?: Record<string, string | undefined> }} options
 * @returns {string}
 */
export function describeBuild({ root, env = process.env }) {
  return fromEnvironment(env) ?? fromCheckout(root) ?? DEVELOPMENT_BUILD;
}
