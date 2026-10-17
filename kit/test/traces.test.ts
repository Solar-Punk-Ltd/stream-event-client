import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { deflateRawSync } from 'node:zlib';

import { describe, expect, it } from 'vitest';

import { findLeaks } from '../src/leaks.ts';
import { traceTexts } from '../src/traces.ts';

const KEY = 'ab'.repeat(32);

/** A zip of the given files, each deflated as Playwright writes its traces. */
function zip(files: Record<string, string>): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const [name, text] of Object.entries(files)) {
    const raw = Buffer.from(text);
    const data = deflateRawSync(raw);
    const nameBytes = Buffer.from(name);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(8, 10);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(raw.length, 24);
    central.writeUInt16LE(nameBytes.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(local, nameBytes, data);
    centrals.push(central, nameBytes);
    offset += local.length + nameBytes.length + data.length;
  }
  const directory = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(Object.keys(files).length, 8);
  end.writeUInt16LE(Object.keys(files).length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}

describe('traceTexts', () => {
  it('reads every file inside every trace of a folder, so a key a trace holds is found', () => {
    const dir = mkdtempSync(join(tmpdir(), 'kit-traces-'));
    writeFileSync(join(dir, 'trace-01.zip'), zip({ 'trace.trace': '{"type":"before"}', 'trace.network': 'none' }));
    writeFileSync(join(dir, 'trace-02.zip'), zip({ 'trace.trace': `{"result":"0x${KEY}"}` }));
    writeFileSync(join(dir, 'network.har'), `not a trace ${KEY}`);
    const texts = traceTexts(dir);
    expect(Object.keys(texts).sort()).toEqual([
      'trace-01.zip/trace.network',
      'trace-01.zip/trace.trace',
      'trace-02.zip/trace.trace',
    ]);
    expect(findLeaks(texts, { 'account key': KEY })).toEqual(['account key in trace-02.zip/trace.trace']);
  });
});
