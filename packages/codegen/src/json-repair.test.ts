import { describe, expect, it } from 'vitest';
import { repairJson, stringifyJson } from './json-repair';

describe('repairJson', () => {
  it('parses valid JSON unchanged', () => {
    expect(repairJson('{"jsx":"react-jsx"}')).toEqual({ jsx: 'react-jsx' });
  });

  it('strips trailing commas in objects and arrays', () => {
    expect(repairJson('{"a":1,"b":[2,3,],}')).toEqual({ a: 1, b: [2, 3] });
  });

  it('strips a trailing comma at EOF', () => {
    expect(repairJson('{"name":"shop","dependencies":{"clsx":"2.1.1",')).toEqual({
      name: 'shop',
      dependencies: { clsx: '2.1.1' },
    });
  });

  it('strips line and block comments outside strings', () => {
    const raw = `{
      // name
      "name": "app",
      /* version */
      "version": "1.0.0"
    }`;
    expect(repairJson(raw)).toEqual({ name: 'app', version: '1.0.0' });
  });

  it('does not treat comment markers inside strings as comments', () => {
    expect(repairJson('{"url":"https://example.com/a//b"}')).toEqual({
      url: 'https://example.com/a//b',
    });
  });

  it('closes truncated objects, arrays, and strings', () => {
    expect(repairJson('{"name":"app","dependencies":{"react":"19')).toEqual({
      name: 'app',
      dependencies: { react: '19' },
    });
  });

  it('drops an incomplete key/value instead of inserting null', () => {
    expect(repairJson('{"compilerOptions":{"strict":')).toEqual({ compilerOptions: {} });
    expect(repairJson('{"scripts":{"dev":')).toEqual({ scripts: {} });
  });

  it('returns null for irreparable input', () => {
    expect(repairJson('not json at all')).toBeNull();
    expect(repairJson('')).toBeNull();
  });
});

describe('stringifyJson', () => {
  it('pretty-prints with a trailing newline', () => {
    expect(stringifyJson({ a: 1 })).toBe('{\n  "a": 1\n}\n');
  });
});
