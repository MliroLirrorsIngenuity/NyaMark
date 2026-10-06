import { describe, expect, test } from 'bun:test';
import { type DiffRow, lineDiff } from '../src/ai/agent/line-diff';

const lines = (count: number, from = 1) =>
  Array.from({ length: count }, (_, index) => `line ${from + index}`);

const text = (list: string[]) => `${list.join('\n')}\n`;

const same = (line: string): DiffRow => ({ kind: 'same', text: line });
const gap = (count: number): DiffRow => ({ kind: 'gap', text: String(count) });

describe('the lines a write changes', () => {
  test('shows a change with two kept lines around it and gaps for the rest', () => {
    const before = lines(10);
    const after = [...before];
    after[4] = 'line five';
    expect(lineDiff(text(before), text(after))).toEqual({
      rows: [
        gap(2),
        same('line 3'),
        same('line 4'),
        { kind: 'removed', text: 'line 5' },
        { kind: 'added', text: 'line five' },
        same('line 6'),
        same('line 7'),
        gap(3),
      ],
      added: 1,
      removed: 1,
      truncated: false,
    });
  });

  test('reads lines ended by CRLF as a read of the note does', () => {
    const before = 'one\r\ntwo\r\nthree\r\n';
    const after = 'one\r\nTWO\r\nthree\r\n';
    expect(lineDiff(before, after).rows).toEqual([
      same('one'),
      { kind: 'removed', text: 'two' },
      { kind: 'added', text: 'TWO' },
      same('three'),
    ]);
  });

  test('keeps a short run of kept lines between two changes whole', () => {
    const before = lines(8);
    const after = [...before];
    after[1] = 'two';
    after[5] = 'six';
    const { rows } = lineDiff(text(before), text(after));
    expect(rows.map((row) => row.kind)).toEqual([
      'same',
      'removed',
      'added',
      'same',
      'same',
      'same',
      'removed',
      'added',
      'same',
      'same',
    ]);
  });

  test('shows a new note as all added lines', () => {
    expect(lineDiff('', 'one\ntwo\n')).toEqual({
      rows: [
        { kind: 'added', text: 'one' },
        { kind: 'added', text: 'two' },
      ],
      added: 2,
      removed: 0,
      truncated: false,
    });
  });

  test('counts lines past the most it shows, and says it left them out', () => {
    const diff = lineDiff('', text(lines(200)));
    expect(diff.rows).toHaveLength(120);
    expect(diff.added).toBe(200);
    expect(diff.truncated).toBe(true);
  });

  test('reads a last line without a newline as a line', () => {
    const diff = lineDiff('one\ntwo', 'one\ntwo\nthree');
    expect(diff.added).toBe(1);
    expect(diff.removed).toBe(0);
    expect(diff.rows.at(-1)).toEqual({ kind: 'added', text: 'three' });
  });
});
