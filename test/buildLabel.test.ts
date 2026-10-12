import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it } from 'vitest';

import { DEVELOPMENT_BUILD, describeBuild } from '../scripts/build-label.mjs';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const made: string[] = [];

function folder(): string {
  const dir = mkdtempSync(join(tmpdir(), 'build-label-'));
  made.push(dir);
  return dir;
}

// Signing, hooks and identity come from settings on the machine running the test, so each is stated here.
const GIT_SETTINGS = [
  '-c',
  'user.name=Test',
  '-c',
  'user.email=test@example.com',
  '-c',
  'commit.gpgsign=false',
  '-c',
  'tag.gpgsign=false',
  '-c',
  'core.hooksPath=/dev/null',
];

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', [...GIT_SETTINGS, ...args], { cwd, encoding: 'utf8' }).trim();
}

function repo(): string {
  const dir = folder();
  git(dir, 'init', '--quiet');
  return dir;
}

function commit(dir: string, name: string): string {
  writeFileSync(join(dir, name), name);
  git(dir, 'add', name);
  git(dir, 'commit', '--quiet', '-m', name);
  return git(dir, 'rev-parse', 'HEAD').slice(0, 7);
}

afterEach(() => {
  for (const dir of made.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('the build label from the release tag', () => {
  it('names a tagged commit by its tag and short commit', () => {
    const dir = repo();
    const short = commit(dir, 'a');
    git(dir, 'tag', '-a', 'v1.7.0-rc.5', '-m', 'release');
    expect(describeBuild({ root: dir, env: {} })).toBe(`v1.7.0-rc.5 (${short})`);
  });

  it('prefers an annotated tag to a lightweight one on the same commit', () => {
    const dir = repo();
    const short = commit(dir, 'a');
    // A lightweight tag on the same commit as the annotated one, which the annotated one must win over.
    git(dir, 'tag', 'lightweight-first');
    git(dir, 'tag', '-a', 'v1.0.0', '-m', 'release');
    expect(describeBuild({ root: dir, env: {} })).toBe(`v1.0.0 (${short})`);
  });

  it('names a lightweight tag when the commit carries no annotated one', () => {
    const dir = repo();
    const short = commit(dir, 'a');
    git(dir, 'tag', 'v1.0.0');
    expect(describeBuild({ root: dir, env: {} })).toBe(`v1.0.0 (${short})`);
  });

  it('names an untagged commit by the nearest tag behind it and how many commits past it', () => {
    const dir = repo();
    commit(dir, 'a');
    git(dir, 'tag', '-a', 'v1.7.0-rc.5', '-m', 'release');
    commit(dir, 'b');
    commit(dir, 'c');
    const short = commit(dir, 'd');
    expect(describeBuild({ root: dir, env: {} })).toBe(`v1.7.0-rc.5+3 (${short})`);
  });

  it('names a commit with no tag behind it by the short commit alone', () => {
    const dir = repo();
    const short = commit(dir, 'a');
    expect(describeBuild({ root: dir, env: {} })).toBe(short);
  });

  it('marks a tree with uncommitted changes as dirty', () => {
    const dir = repo();
    const short = commit(dir, 'a');
    git(dir, 'tag', '-a', 'v1.0.0', '-m', 'release');
    writeFileSync(join(dir, 'a'), 'changed');
    expect(describeBuild({ root: dir, env: {} })).toBe(`v1.0.0-dirty (${short})`);
  });

  it('passes over a tag whose name a page would have to escape', () => {
    const dir = repo();
    commit(dir, 'a');
    git(dir, 'tag', '-a', 'v1.0.0', '-m', 'release');
    const short = commit(dir, 'b');
    git(dir, 'tag', '-a', 'v2<script>', '-m', 'bad');
    expect(describeBuild({ root: dir, env: {} })).toBe(`v1.0.0+1 (${short})`);
  });

  it('takes the tag and commit the publishing workflow hands the build, with no git at all', () => {
    const env = { BUILD_TAG: 'v1.7.0-rc.5', BUILD_COMMIT: '1fcfbd4c0ffee1fcfbd4c0ffee1fcfbd4c0ffee0' };
    expect(describeBuild({ root: folder(), env })).toBe('v1.7.0-rc.5 (1fcfbd4)');
  });

  it('prefers what the workflow hands over to what git would say', () => {
    const dir = repo();
    commit(dir, 'a');
    git(dir, 'tag', '-a', 'v0.0.1', '-m', 'old');
    const env = { BUILD_TAG: 'v1.7.0-rc.5', BUILD_COMMIT: '1fcfbd4' };
    expect(describeBuild({ root: dir, env })).toBe('v1.7.0-rc.5 (1fcfbd4)');
  });

  it('refuses a tag or commit of the wrong shape rather than bake it into the page', () => {
    expect(() => describeBuild({ root: folder(), env: { BUILD_TAG: 'v1 <b>' } })).toThrow(/BUILD_TAG/);
    expect(() => describeBuild({ root: folder(), env: { BUILD_TAG: 'v1..2' } })).toThrow(/BUILD_TAG/);
    expect(() => describeBuild({ root: folder(), env: { BUILD_TAG: 'v1', BUILD_COMMIT: 'xyz' } })).toThrow(
      /BUILD_COMMIT/,
    );
  });

  it('calls a build with neither a handed-over tag nor a git checkout a development build', () => {
    expect(describeBuild({ root: folder(), env: {} })).toBe(DEVELOPMENT_BUILD);
    expect(DEVELOPMENT_BUILD).toBe('development build');
  });

  it('does not borrow the label of a checkout the folder only sits inside', () => {
    const outer = repo();
    commit(outer, 'a');
    git(outer, 'tag', '-a', 'v9.9.9', '-m', 'outer');
    const inner = join(outer, 'inner');
    mkdirSync(inner);
    expect(describeBuild({ root: inner, env: {} })).toBe(DEVELOPMENT_BUILD);
  });
});

describe('the release tag reaching the image build', () => {
  const dockerfile = readFileSync(join(ROOT, 'Dockerfile'), 'utf8');
  const workflow = readFileSync(join(ROOT, '.github/workflows/image.yml'), 'utf8');
  const viteConfig = readFileSync(join(ROOT, 'vite.config.js'), 'utf8');

  // An ARG above the build stage's FROM is not visible inside that stage, so both must sit between the two.
  it('declares the tag and commit as build arguments inside the build stage, before the bundle is built', () => {
    const stage = dockerfile.indexOf('FROM node:');
    const build = dockerfile.indexOf('RUN pnpm build');
    expect(stage).toBeGreaterThan(-1);
    for (const arg of ['ARG BUILD_TAG', 'ARG BUILD_COMMIT']) {
      expect(dockerfile.indexOf(arg), arg).toBeGreaterThan(stage);
      expect(dockerfile.indexOf(arg), arg).toBeLessThan(build);
    }
  });

  it('has the publishing workflow pass the pushed tag and its commit', () => {
    expect(workflow).toContain('BUILD_TAG=${{ github.ref_name }}');
    expect(workflow).toContain('BUILD_COMMIT=${{ github.sha }}');
  });

  it('bakes the label the script describes rather than the package version', () => {
    expect(viteConfig).toContain('describeBuild');
    expect(viteConfig).not.toContain('package.json');
  });
});
