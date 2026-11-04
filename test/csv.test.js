import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toCsv } from '../src/main/services/csv.js';

test('toCsv renders header and rows with CRLF endings', () => {
  const csv = toCsv(
    [{ id: 1, name: 'A' }, { id: 2, name: 'B' }],
    [{ key: 'id', label: 'ID' }, { key: 'name', label: 'Name' }]
  );
  assert.equal(csv, 'ID,Name\r\n1,A\r\n2,B\r\n');
});

test('toCsv quotes fields containing commas, quotes, or newlines', () => {
  const csv = toCsv(
    [{ a: 'x,y', b: 'say "hi"', c: 'line1\nline2' }],
    [{ key: 'a', label: 'A' }, { key: 'b', label: 'B' }, { key: 'c', label: 'C' }]
  );
  assert.equal(csv, 'A,B,C\r\n"x,y","say ""hi""","line1\nline2"\r\n');
});

test('toCsv renders null/undefined cells as empty', () => {
  const csv = toCsv(
    [{ a: null, b: undefined, c: 0, d: '' }],
    [{ key: 'a', label: 'A' }, { key: 'b', label: 'B' },
     { key: 'c', label: 'C' }, { key: 'd', label: 'D' }]
  );
  assert.equal(csv, 'A,B,C,D\r\n,,0,\r\n');
});

test('toCsv with zero rows emits just the header', () => {
  const csv = toCsv([], [{ key: 'x', label: 'X' }]);
  assert.equal(csv, 'X\r\n');
});

test('toCsv escapes quotes in header cells too', () => {
  const csv = toCsv([], [{ key: 'x', label: 'weird "header"' }]);
  assert.equal(csv, '"weird ""header"""\r\n');
});
