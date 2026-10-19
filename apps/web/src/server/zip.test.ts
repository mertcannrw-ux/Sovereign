// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { inflateRawSync } from 'node:zlib';
import { createZip, safeZipPath } from './zip';

/** Read entries back by walking the central directory. */
function readZip(zip: Buffer): Record<string, string> {
  const end = zip.length - 22;
  expect(zip.readUInt32LE(end)).toBe(0x06054b50);
  const count = zip.readUInt16LE(end + 10);
  let cursor = zip.readUInt32LE(end + 16);
  const files: Record<string, string> = {};
  for (let i = 0; i < count; i++) {
    expect(zip.readUInt32LE(cursor)).toBe(0x02014b50);
    const size = zip.readUInt32LE(cursor + 20);
    const nameLength = zip.readUInt16LE(cursor + 28);
    const localOffset = zip.readUInt32LE(cursor + 42);
    const name = zip.subarray(cursor + 46, cursor + 46 + nameLength).toString('utf8');
    const dataStart = localOffset + 30 + zip.readUInt16LE(localOffset + 26);
    files[name] = inflateRawSync(zip.subarray(dataStart, dataStart + size)).toString('utf8');
    cursor += 46 + nameLength;
  }
  return files;
}

describe('createZip', () => {
  it('round-trips entries', () => {
    const zip = createZip([
      { path: 'account.json', data: '{"a":1}' },
      { path: 'projects/demo/files/src/ä.ts', data: 'export {};' },
    ]);
    expect(readZip(zip)).toEqual({
      'account.json': '{"a":1}',
      'projects/demo/files/src/ä.ts': 'export {};',
    });
  });
});

describe('safeZipPath', () => {
  it('drops traversal and empty segments', () => {
    expect(safeZipPath('/../src//./app.ts')).toBe('src/app.ts');
    expect(safeZipPath('..\\..\\etc\\passwd')).toBe('etc/passwd');
  });
});
