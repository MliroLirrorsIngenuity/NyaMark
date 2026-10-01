import { describe, expect, test } from 'bun:test';
import { Schema } from '@milkdown/kit/prose/model';
import { EditorState, TextSelection } from '@milkdown/kit/prose/state';
import { pasteCode, pastedLanguage } from '../src/editor/plugins/paste-code';

const schema = new Schema({
  nodes: {
    doc: { content: 'block+' },
    paragraph: { group: 'block', content: 'inline*' },
    code_block: {
      group: 'block',
      content: 'text*',
      code: true,
      attrs: { language: { default: '' } },
    },
    cell: { group: 'block', content: 'paragraph' },
    text: { group: 'inline' },
  },
});

/** A document of `lines`, the caret at `at`. */
function doc(lines: string[], at: number) {
  const node = schema.node(
    'doc',
    null,
    lines.map((line) =>
      schema.node('paragraph', null, line ? schema.text(line) : [])
    )
  );
  return EditorState.create({
    doc: node,
    selection: TextSelection.create(node, at),
  });
}

const CODE = 'def f():\n    # 注释\n    return 1';

const VSCODE =
  "<meta charset='utf-8'><div style=\"color: #cccccc;font-family: Menlo, Monaco, 'Courier New', monospace;white-space: pre;\"><div><span>def f():</span></div></div>";

describe('pastedLanguage', () => {
  test('knows code copied from an editor by its HTML', () => {
    expect(pastedLanguage(CODE, VSCODE)).toBe('');
  });

  test('leaves other text alone', () => {
    expect(pastedLanguage(CODE, '')).toBeNull();
    expect(pastedLanguage('a', '<p>a</p>')).toBeNull();
  });
});

describe('pasteCode', () => {
  test('puts lines of code on an empty line in its place', () => {
    const tr = pasteCode(doc(['前', '', '后'], 4), `${CODE}\n`, 'python');
    expect(
      tr?.doc.toJSON().content.map((node: { type: string }) => node.type)
    ).toEqual(['paragraph', 'code_block', 'paragraph']);
    const block = tr?.doc.child(1);
    expect(block?.textContent).toBe(CODE);
    expect(block?.attrs.language).toBe('python');
    expect(tr?.selection.$head.parent).toBe(block);
    expect(tr?.selection.$head.parentOffset).toBe(CODE.length);
  });

  test('splits a line pasted into', () => {
    const tr = pasteCode(doc(['前文后文'], 3), CODE, '');
    expect(
      tr?.doc.toJSON().content.map((node: { type: string }) => node.type)
    ).toEqual(['paragraph', 'code_block', 'paragraph']);
    expect(tr?.doc.child(0).textContent).toBe('前文');
    expect(tr?.doc.child(2).textContent).toBe('后文');
    expect(tr?.selection.$head.parent.type.name).toBe('code_block');
  });

  test('types one line into the text as it reads', () => {
    const tr = pasteCode(doc(['看'], 2), '__init__\n', '');
    expect(tr?.doc.textContent).toBe('看__init__');
  });

  test('leaves the paste where no code block can go', () => {
    const cell = schema.node('doc', null, [
      schema.node('cell', null, [schema.node('paragraph')]),
    ]);
    const state = EditorState.create({
      doc: cell,
      selection: TextSelection.create(cell, 2),
    });
    expect(pasteCode(state, CODE, '')).toBeNull();
  });
});
