import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { inflateRawSync } from 'node:zlib';

const END_OF_DIRECTORY = 0x06054b50;
const DIRECTORY_ENTRY = 0x02014b50;
const LOCAL_HEADER_LENGTH = 30;
const DEFLATED = 8;

/** Every file in one zip as text, read from its central directory, stored or deflated as Playwright writes them. */
function unzip(bytes: Buffer): Record<string, string> {
  const end = bytes.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (end < 0 || bytes.readUInt32LE(end) !== END_OF_DIRECTORY) throw new Error('not a zip: no end of its directory');
  const count = bytes.readUInt16LE(end + 10);
  let at = bytes.readUInt32LE(end + 16);
  const files: Record<string, string> = {};
  for (let i = 0; i < count; i++) {
    if (bytes.readUInt32LE(at) !== DIRECTORY_ENTRY) throw new Error('not a zip: a broken directory entry');
    const method = bytes.readUInt16LE(at + 10);
    const size = bytes.readUInt32LE(at + 20);
    const nameLength = bytes.readUInt16LE(at + 28);
    const extraLength = bytes.readUInt16LE(at + 30);
    const commentLength = bytes.readUInt16LE(at + 32);
    const local = bytes.readUInt32LE(at + 42);
    const name = bytes.subarray(at + 46, at + 46 + nameLength).toString('utf8');
    const dataAt = local + LOCAL_HEADER_LENGTH + bytes.readUInt16LE(local + 26) + bytes.readUInt16LE(local + 28);
    const data = bytes.subarray(dataAt, dataAt + size);
    files[name] = (method === DEFLATED ? inflateRawSync(data) : data).toString('latin1');
    at += 46 + nameLength + extraLength + commentLength;
  }
  return files;
}

/**
 * The text of every file inside every trace of an actor's folder, keyed `<trace>/<file>`, so a secret a trace holds,
 * in a snapshot, a call's result or a network body, can be looked for as in any other text.
 */
export function traceTexts(dir: string): Record<string, string> {
  const texts: Record<string, string> = {};
  for (const trace of readdirSync(dir).filter((name) => /^trace-.*\.zip$/.test(name))) {
    for (const [file, text] of Object.entries(unzip(readFileSync(join(dir, trace))))) texts[`${trace}/${file}`] = text;
  }
  return texts;
}
