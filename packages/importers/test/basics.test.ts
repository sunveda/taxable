import { describe, expect, it } from 'vitest';
import { decodeText, importCsv, parseCsvRecords, UnknownFormatError } from '../src';
import { parseAmount, parseTimestamp } from '../src/values';

describe('CSV parsing', () => {
  it('handles quotes, embedded commas and newlines, CRLF, BOM and blank lines', () => {
    const text = '﻿a,b,c\r\n"x, y","multi\nline","say ""hi"""\r\n\r\n1,2,3';
    const records = parseCsvRecords(text);
    expect(records.map((r) => r.fields)).toEqual([
      ['a', 'b', 'c'],
      ['x, y', 'multi\nline', 'say "hi"'],
      ['1', '2', '3'],
    ]);
    expect(records.map((r) => r.line)).toEqual([1, 2, 5]);
  });

  it('rejects files no importer recognizes', () => {
    expect(() => importCsv('foo,bar\n1,2', { accountId: 'x' })).toThrow(UnknownFormatError);
  });
});

describe('values', () => {
  it.each([
    ['1,234.56', '1234.56'],
    ['$1,234.56', '1234.56'],
    ['-$5.00', '-5'],
    ['¥1,000', '1000'],
    ['１２３．５', '123.5'],
    ['(12.5)', '-12.5'],
    ['0.5 USD', '0.5'],
    ['1e-8', '1e-8'],
  ])('parses amount %s', (raw, expected) => {
    expect(parseAmount(raw)?.equals(expected)).toBe(true);
  });

  it.each(['', 'abc', '1.2.3', '--1'])('rejects amount %j', (raw) => {
    expect(parseAmount(raw)).toBeNull();
  });

  it.each([
    ['2024-01-15 17:00:00 UTC', 'Z', '2024-01-15T17:00:00Z'],
    ['2024-01-15T17:00:00Z', 'Z', '2024-01-15T17:00:00Z'],
    ['2024-01-15 17:00:00.1234', 'Z', '2024-01-15T17:00:00.123Z'],
    ['2025/01/02 9:05:03', '+09:00', '2025-01-02T09:05:03+09:00'],
    ['2025/1/2 09:05', '+09:00', '2025-01-02T09:05:00+09:00'],
    ['2025-01-02T09:05:03+0900', 'Z', '2025-01-02T09:05:03+09:00'],
  ] as const)('parses timestamp %s', (raw, offset, expected) => {
    expect(parseTimestamp(raw, offset)).toBe(expected);
  });

  it('rejects impossible dates', () => {
    expect(parseTimestamp('2025-13-40 10:00:00', 'Z')).toBeNull();
  });
});

describe('text decoding', () => {
  it('decodes UTF-8 and falls back to Shift_JIS', () => {
    const utf8 = new Uint8Array([229, 143, 150, 229, 188, 149, 230, 151, 165, 230, 153, 130]);
    expect(decodeText(utf8)).toEqual({ text: '取引日時', encoding: 'utf-8' });
    const sjis = new Uint8Array([
      142, 230, 136, 248, 147, 250, 142, 158, 44, 142, 230, 136, 248, 142, 237, 149, 202, 10,
    ]);
    expect(decodeText(sjis)).toEqual({ text: '取引日時,取引種別\n', encoding: 'shift_jis' });
  });
});
