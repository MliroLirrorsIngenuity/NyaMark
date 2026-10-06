import { describe, expect, test } from 'bun:test';
import { type Node, Schema, Slice } from '@milkdown/kit/prose/model';
import { tableNodes } from '@milkdown/kit/prose/tables';
import {
  type HunkDraft,
  alignBlocks,
  inlineTokens,
} from '../src/ai/edit/align';
import { applyHunks, proposeEdit } from '../src/ai/edit/propose';
import {
  EditError,
  insertAfterLine,
  replaceText,
  rewriteText,
} from '../src/ai/edit/text-edit';
import { matchPairs } from '../src/editor/myers';
import { type Hunk, fragmentsMatch } from '../src/editor/plugins/ai-proposals';
import {
  code,
  doc,
  env,
  h,
  hr,
  p,
  parse,
  quote,
  schema,
  serialize,
  ul,
} from './ai-edit-helpers';

/** A seeded random source, for fuzzing that fails the same way twice. */
function random(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
}

function lcsLength<T>(a: readonly T[], b: readonly T[]) {
  const table = Array.from({ length: a.length + 1 }, () =>
    new Array<number>(b.length + 1).fill(0)
  );
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      table[i][j] =
        a[i - 1] === b[j - 1]
          ? table[i - 1][j - 1] + 1
          : Math.max(table[i - 1][j], table[i][j - 1]);
    }
  }
  return table[a.length][b.length];
}

describe('matchPairs', () => {
  test('finds a longest common run, in order', () => {
    const next = random(7);
    for (let round = 0; round < 400; round++) {
      const length = () => Math.floor(next() * 12);
      const item = () => 'abcd'[Math.floor(next() * 4)];
      const a = Array.from({ length: length() }, item);
      const b = Array.from({ length: length() }, item);
      const pairs = matchPairs(a, b, (x, y) => x === y);
      if (!pairs) throw new Error('no pairs');
      expect(pairs.length).toBe(lcsLength(a, b));
      let last: [number, number] = [-1, -1];
      for (const pair of pairs) {
        expect(a[pair[0]]).toBe(b[pair[1]]);
        expect(pair[0]).toBeGreaterThan(last[0]);
        expect(pair[1]).toBeGreaterThan(last[1]);
        last = pair;
      }
    }
  });

  test('gives up past the cost it is allowed', () => {
    const a = Array.from({ length: 50 }, (_, i) => i);
    const b = Array.from({ length: 50 }, (_, i) => i + 100);
    expect(matchPairs(a, b, (x, y) => x === y, 20)).toBeNull();
    expect(matchPairs(a, b, (x, y) => x === y, 200)).toEqual([]);
  });
});

describe('inlineTokens', () => {
  test('splits words, CJK characters, spaces and marks', () => {
    const tokens = inlineTokens(p('Hi, 你好 **there**').content);
    expect(tokens.map((token) => token.text)).toEqual([
      'Hi',
      ',',
      ' ',
      '你',
      '好',
      ' ',
      'there',
    ]);
    expect(tokens[6].key).not.toBe(inlineTokens(p('there').content)[0].key);
  });
});

/** `node`'s children with the drafts applied, as a document. */
function applied(node: Node, drafts: readonly HunkDraft[]) {
  const transform = applyHunks(
    node,
    drafts.map((draft) => ({ ...draft, insert: new Slice(draft.insert, 0, 0) }))
  );
  if (!transform) throw new Error('the drafts do not fit');
  return transform.doc;
}

function align(a: Node, b: Node) {
  const blocks = (node: Node) => {
    const list: Node[] = [];
    for (let i = 0; i < node.childCount; i++) list.push(node.child(i));
    return list;
  };
  const drafts = alignBlocks(blocks(a), 0, blocks(b));
  expect(fragmentsMatch(applied(a, drafts).content, b.content)).toBe(true);
  return drafts;
}

describe('alignBlocks', () => {
  test('a changed word is one inline hunk', () => {
    const drafts = align(
      doc(h(1, 'Title'), p('The quick brown fox.')),
      doc(h(1, 'Title'), p('The slow brown fox.'))
    );
    expect(drafts).toHaveLength(1);
    expect(drafts[0].kind).toBe('inline');
    expect(drafts[0].insert.textBetween(0, drafts[0].insert.size)).toBe('slow');
  });

  test('changes a space apart are one hunk, a word apart two', () => {
    expect(
      align(doc(p('The quick brown fox')), doc(p('A fast brown fox')))
    ).toHaveLength(1);
    expect(
      align(doc(p('the cat sat on it')), doc(p('a cat ran on it')))
    ).toHaveLength(2);
  });

  test('CJK changes one character apart are one hunk', () => {
    expect(align(doc(p('我们今天散步')), doc(p('他们明天散步')))).toHaveLength(
      1
    );
    expect(
      align(doc(p('我们今天去公园散步')), doc(p('他们明天去学校散步')))
    ).toHaveLength(2);
  });

  test('a paragraph put in is a block hunk at its place', () => {
    const drafts = align(
      doc(p('one'), p('three')),
      doc(p('one'), p('two'), p('three'))
    );
    expect(drafts).toEqual([
      expect.objectContaining({ kind: 'block', from: 5, to: 5 }),
    ]);
  });

  test('a heading of another level is replaced whole', () => {
    const drafts = align(doc(h(2, 'Setup')), doc(h(3, 'Setup')));
    expect(drafts).toEqual([
      expect.objectContaining({ kind: 'block', from: 0 }),
    ]);
  });

  test('a list is gone through item by item', () => {
    const drafts = align(
      doc(ul('apples', 'pears', 'plums')),
      doc(ul('apples', 'ripe pears', 'plums'))
    );
    expect(drafts).toHaveLength(1);
    expect(drafts[0].kind).toBe('inline');
  });

  test('a code block is replaced whole', () => {
    const drafts = align(doc(code('let a = 1;')), doc(code('let a = 2;')));
    expect(drafts).toEqual([expect.objectContaining({ kind: 'block' })]);
  });

  test('any block of blocks is gone through, and a table replaced whole', () => {
    const wide = new Schema({
      nodes: schema.spec.nodes
        .addToEnd('details', { group: 'block', content: 'block+' })
        .append(
          tableNodes({
            tableGroup: 'block',
            cellContent: 'paragraph',
            cellAttributes: {},
          })
        ),
      marks: schema.spec.marks,
    });
    const para = (text: string) =>
      wide.node('paragraph', null, wide.text(text));
    const details = (text: string) =>
      wide.node(
        'doc',
        null,
        wide.node('details', null, [para('one'), para(text)])
      );
    const table = (text: string) =>
      wide.node('doc', null, [
        wide.node('table', null, [
          wide.node('table_row', null, [
            wide.node('table_cell', null, para('one')),
            wide.node('table_cell', null, para(text)),
          ]),
        ]),
      ]);
    const kinds = (drafts: readonly HunkDraft[]) =>
      drafts.map((draft) => [draft.kind, draft.from]);
    expect(kinds(align(details('red apples'), details('ripe apples')))).toEqual(
      [['inline', 7]]
    );
    expect(kinds(align(table('red apples'), table('ripe apples')))).toEqual([
      ['block', 0],
    ]);
  });

  test('a rewritten paragraph is one hunk', () => {
    const drafts = align(
      doc(p('alpha beta gamma delta')),
      doc(p('one two three four gamma'))
    );
    expect(drafts).toHaveLength(1);
  });

  test('every hunk fits alone and any subset together', () => {
    const next = random(11);
    const words = ['red', 'green', 'blue', 'cat', '猫', '狗', 'sun', 'moon'];
    const sentence = () =>
      Array.from(
        { length: 1 + Math.floor(next() * 6) },
        () => words[Math.floor(next() * words.length)]
      ).join(' ');
    const block = () => {
      const kind = next();
      if (kind < 0.5) return p(sentence());
      if (kind < 0.65) return h(1 + Math.floor(next() * 3), sentence());
      if (kind < 0.8) return ul(sentence(), sentence());
      if (kind < 0.9) return quote(p(sentence()));
      return next() < 0.5 ? hr() : code(sentence());
    };
    for (let round = 0; round < 200; round++) {
      const a = Array.from({ length: 1 + Math.floor(next() * 6) }, block);
      const b = a.map((node) => (next() < 0.4 ? block() : node));
      if (next() < 0.3) b.splice(Math.floor(next() * b.length), 0, block());
      if (next() < 0.3 && b.length > 1)
        b.splice(Math.floor(next() * b.length), 1);
      const before = doc(...a);
      const drafts = align(before, doc(...b));
      for (const draft of drafts) applied(before, [draft]);
      const subset = drafts.filter(() => next() < 0.5);
      applied(before, subset).check();
    }
  });
});

describe('text edits', () => {
  test('replaces a string found once', () => {
    expect(replaceText('a b c', 'b', 'x')).toEqual({
      next: 'a x c',
      from: 2,
      to: 3,
    });
  });

  test('asks which of several, or replaces them all', () => {
    expect(() => replaceText('a\nb\na\n', 'a', 'x')).toThrow('lines 1, 3');
    expect(replaceText('a\nb\na\n', 'a', 'x', true).next).toBe('x\nb\nx\n');
  });

  test('says where text like it is when it is not found', () => {
    try {
      replaceText('# Title\n\nSome words here.\n', 'Some words there.', 'x');
      throw new Error('no error');
    } catch (error) {
      expect(error).toBeInstanceOf(EditError);
      expect((error as EditError).code).toBe('not_found');
    }
    expect(() =>
      replaceText('one\nSome words here.\n', 'Some words', 'x')
    ).not.toThrow();
  });

  test('takes off line numbers copied from a read', () => {
    expect(replaceText('one\ntwo\n', '2\ttwo', '2\tTWO').next).toBe(
      'one\nTWO\n'
    );
  });

  test('puts text in after a line with blank lines around it', () => {
    expect(insertAfterLine('a\nb\n', 1, 'X').next).toBe('a\n\nX\n\nb\n');
    expect(insertAfterLine('a\nb\n', 2, 'X').next).toBe('a\nb\n\nX\n');
    expect(insertAfterLine('a\nb', 2, 'X').next).toBe('a\nb\n\nX\n');
    expect(insertAfterLine('a\n\nb\n', 0, 'X').next).toBe('X\n\na\n\nb\n');
    expect(insertAfterLine('a\n\nb\n', 2, 'X').next).toBe('a\n\nX\n\nb\n');
    expect(insertAfterLine('a\n\nb\n', 1, 'X').next).toBe('a\n\nX\n\nb\n');
    expect(() => insertAfterLine('a\n', 5, 'X')).toThrow('past the end');
  });

  test('a rewrite to the same text is no change', () => {
    expect(() => rewriteText('a', 'a')).toThrow(EditError);
  });
});

let nextId = 1;

function asHunks(drafts: ReturnType<typeof proposeEdit>['hunks'], edit = 'e') {
  return drafts.map(
    (draft): Hunk => ({
      ...draft,
      id: nextId++,
      edit,
      insert: new Slice(draft.insert, 0, 0),
    })
  );
}

/** Proposes `edit` on `text` with `pending` in it; the hunks kept and made. */
function propose(
  current: Node,
  pending: Hunk[],
  edit: (text: string) => ReturnType<typeof replaceText>
) {
  const result = proposeEdit(env, current, pending, edit);
  const hunks = [
    ...pending.filter((hunk) => !result.dropped.includes(hunk.id)),
    ...asHunks(result.hunks),
  ];
  return { result, hunks };
}

function acceptAll(current: Node, hunks: readonly Hunk[]) {
  const transform = applyHunks(current, hunks);
  if (!transform) throw new Error('the hunks do not fit');
  return transform.doc;
}

describe('proposeEdit', () => {
  const text = '# Notes\n\nThe quick brown fox.\n\n- apples\n- pears\n\nEnd.\n';

  test('a word replaced is one inline hunk and reads as intended', () => {
    const current = parse(text);
    const { result, hunks } = propose(current, [], (t) =>
      replaceText(t, 'quick', 'slow')
    );
    expect(hunks).toHaveLength(1);
    expect(hunks[0].kind).toBe('inline');
    expect(result.after).toBe(result.intended);
    expect(serialize(acceptAll(current, hunks))).toBe(result.intended);
  });

  test('a second edit can build on the first, still pending', () => {
    const current = parse(text);
    const first = propose(current, [], (t) => replaceText(t, 'quick', 'slow'));
    const second = propose(current, first.hunks, (t) =>
      replaceText(t, 'slow brown', 'slow red')
    );
    expect(second.result.before).toContain('The slow brown fox.');
    expect(second.result.dropped).toEqual(first.hunks.map((hunk) => hunk.id));
    expect(serialize(acceptAll(current, second.hunks))).toBe(
      '# Notes\n\nThe slow red fox.\n\n- apples\n- pears\n\nEnd.\n'
    );
  });

  test('edits apart keep their own hunks', () => {
    const current = parse(text);
    const first = propose(current, [], (t) => replaceText(t, 'quick', 'slow'));
    const second = propose(current, first.hunks, (t) =>
      replaceText(t, 'End.', 'The end.')
    );
    expect(second.result.dropped).toEqual([]);
    expect(second.hunks).toHaveLength(2);
    expect(second.result.after).toBe(
      '# Notes\n\nThe slow brown fox.\n\n- apples\n- pears\n\nThe end.\n'
    );
  });

  test('an edit taking back a pending one leaves no hunk', () => {
    const current = parse(text);
    const first = propose(current, [], (t) => replaceText(t, 'quick', 'slow'));
    const second = propose(current, first.hunks, (t) =>
      replaceText(t, 'slow', 'quick')
    );
    expect(second.result.hunks).toEqual([]);
    expect(second.result.dropped).toHaveLength(1);
  });

  test('text put in after a line is a block hunk', () => {
    const current = parse(text);
    const { hunks, result } = propose(current, [], (t) =>
      insertAfterLine(t, 3, 'A new paragraph.')
    );
    expect(hunks).toEqual([expect.objectContaining({ kind: 'block' })]);
    expect(hunks[0].from).toBe(hunks[0].to);
    expect(result.after).toContain('The quick brown fox.\n\nA new paragraph.');
  });

  test('an item of a list changes on its own', () => {
    const current = parse(text);
    const { hunks } = propose(current, [], (t) =>
      replaceText(t, '- pears', '- ripe pears')
    );
    expect(hunks).toEqual([expect.objectContaining({ kind: 'inline' })]);
  });

  test('a fence left open is refused', () => {
    const current = parse(`${text}\nMore.\n\nAnd more.\n`);
    try {
      proposeEdit(env, current, [], (t) =>
        replaceText(t, '# Notes', '# Notes\n\n```js')
      );
      throw new Error('no error');
    } catch (error) {
      expect((error as EditError).code).toBe('restructures_document');
    }
  });

  test('a rewrite of the whole document keeps the blocks it leaves', () => {
    const current = parse(text);
    const { result, hunks } = propose(current, [], (t) =>
      rewriteText(t, '# Notes\n\nA new start.\n\n- apples\n- pears\n\nEnd.\n')
    );
    expect(hunks).toHaveLength(1);
    expect(serialize(acceptAll(current, hunks))).toBe(result.intended);
  });

  test('an edit that reads the same is no change', () => {
    const current = parse('One\ntwo.\n');
    try {
      proposeEdit(env, current, [], (t) =>
        replaceText(t, 'One two.', 'One\ntwo.')
      );
      throw new Error('no error');
    } catch (error) {
      expect((error as EditError).code).toBe('no_change');
    }
  });

  test('random edits accept to what was meant, any subset fitting', () => {
    const next = random(23);
    const words = ['alpha', 'beta', 'gamma', '中文', '字', 'delta', 'omega'];
    const sentence = () =>
      Array.from(
        { length: 1 + Math.floor(next() * 5) },
        () => words[Math.floor(next() * words.length)]
      ).join(' ');
    const block = () => {
      const kind = next();
      if (kind < 0.5) return sentence();
      if (kind < 0.65) return `## ${sentence()}`;
      if (kind < 0.8) return `- ${sentence()}\n- ${sentence()}`;
      if (kind < 0.9) return `> ${sentence()}`;
      return next() < 0.5 ? '---' : `\`\`\`\n${sentence()}\n\`\`\``;
    };
    for (let round = 0; round < 150; round++) {
      const blocks = Array.from({ length: 2 + Math.floor(next() * 5) }, block);
      const current = parse(`${blocks.join('\n\n')}\n`);
      let pending: Hunk[] = [];
      for (let step = 0; step < 3; step++) {
        const shown = serialize(acceptAll(current, pending));
        const lines = shown.split('\n').filter(Boolean);
        if (lines.length === 0) break;
        const target = lines[Math.floor(next() * lines.length)];
        const choice = next();
        let edit: (t: string) => ReturnType<typeof replaceText>;
        if (choice < 0.5) {
          edit = (t) => replaceText(t, target, `${target} ${sentence()}`);
        } else if (choice < 0.75) {
          edit = (t) =>
            insertAfterLine(
              t,
              Math.floor(next() * (t.split('\n').length - 1)),
              block()
            );
        } else {
          edit = (t) => replaceText(t, `${target}\n`, '', true);
        }
        let made: ReturnType<typeof propose>;
        try {
          made = propose(current, pending, edit);
        } catch (error) {
          if (error instanceof EditError) continue;
          throw error;
        }
        pending = made.hunks;
        const all = acceptAll(current, pending);
        expect(serialize(all)).toBe(made.result.after);
        expect(serialize(parse(made.result.intended))).toBe(made.result.after);
        for (const hunk of pending) acceptAll(current, [hunk]);
        acceptAll(
          current,
          pending.filter(() => next() < 0.5)
        ).check();
      }
    }
  });
});
