import { describe, expect, test } from 'bun:test';
import { type MarkSpec, Schema } from '@milkdown/kit/prose/model';
import { SerializerState } from '@milkdown/kit/transformer';
import remarkGfm from 'remark-gfm';
import remarkStringify from 'remark-stringify';
import { unified } from 'unified';
import { normalizeOutput } from '../src/editor/plugins/markdown-output';

type Runner = (state: SerializerState, ...rest: never[]) => unknown;
const write = (runner: Runner, spec: object = {}) => ({
  ...spec,
  toMarkdown: { match: () => false, runner },
});

/** Marks written as Milkdown's presets write them, a link around the rest. */
const mark = (name: string, priority?: number): MarkSpec =>
  write(
    (state, mark: never) => {
      state.withMark(mark, name, undefined, {});
    },
    { priority }
  );

const schema = new Schema({
  nodes: {
    doc: write(
      (state, node: { content: never }) => {
        state.openNode('root');
        state.next(node.content);
      },
      { content: 'block+' }
    ),
    paragraph: write(
      (state, node: { content: never }) => {
        state.openNode('paragraph').next(node.content).closeNode();
      },
      { group: 'block', content: 'inline*' }
    ),
    text: write(
      (state, node: { text: string }) => {
        state.addNode('text', undefined, node.text);
      },
      { group: 'inline' }
    ),
  },
  marks: {
    // In the order Milkdown's preset has them.
    emphasis: mark('emphasis'),
    strong: mark('strong'),
    link: write(
      (state, mark: { attrs: { href: string } }) => {
        state.withMark(mark as never, 'link', undefined, {
          url: mark.attrs.href,
        });
      },
      { priority: 10, attrs: { href: {} } }
    ),
    inlineCode: write(
      (state, mark: never, node: { text: string }) => {
        state.withMark(mark, 'inlineCode', node.text);
        return true;
      },
      { priority: 100 }
    ),
  },
});

// Each mark's own spec matches its name.
for (const type of [
  ...Object.values(schema.nodes),
  ...Object.values(schema.marks),
]) {
  type.spec.toMarkdown.match = (node: { type: { name: string } }) =>
    node.type.name === type.name;
}

/** A line of `[text, ...marks]` pieces, written as Milkdown saves it. */
function save(...pieces: [string, ...string[]][]) {
  const remark = unified()
    .use(remarkGfm)
    .use(remarkStringify)
    .use(normalizeOutput);
  const line = pieces.map(([text, ...marks]) =>
    schema.text(
      text,
      marks.map((name) =>
        name === 'link' ? schema.mark('link', { href: 'u' }) : schema.mark(name)
      )
    )
  );
  const doc = schema.node('doc', null, [schema.node('paragraph', null, line)]);
  return SerializerState.create(schema, remark as never)(doc);
}

describe('marks around marks', () => {
  test('keeps bold whole around code and italics', () => {
    expect(
      save(['a ', 'strong'], ['b', 'strong', 'inlineCode'], [' c', 'strong'])
    ).toBe('**a `b` c**\n');
    expect(
      save(['x ', 'emphasis'], ['y', 'emphasis', 'strong'], [' z', 'emphasis'])
    ).toBe('*x **y** z*\n');
  });

  test('keeps a link whole around what is in it', () => {
    expect(save(['粗', 'strong', 'link'], ['体', 'link'])).toBe(
      '[**粗**体](u)\n'
    );
    expect(save(['foo', 'link', 'inlineCode'], [' bar', 'link'])).toBe(
      '[`foo` bar](u)\n'
    );
    expect(
      save(['see ', 'strong'], ['a', 'strong', 'link'], [' now', 'strong'])
    ).toBe('**see [a](u) now**\n');
  });

  test('keeps italics on a link in bold', () => {
    expect(
      save(
        ['a ', 'strong'],
        ['b', 'emphasis', 'strong', 'link'],
        [' c', 'strong']
      )
    ).toBe('**a *[b](u)* c**\n');
  });

  test('writes a link all in bold in the bold', () => {
    expect(save(['a', 'strong', 'link'])).toBe('**[a](u)**\n');
  });

  test('writes the spaces at either end beside the mark', () => {
    expect(save(['word ', 'strong'], ['next'])).toBe('**word** next\n');
    expect(save(['word ', 'link'], ['next'])).toBe('[word](u) next\n');
    expect(save(['x'], [' ', 'emphasis'], ['y'])).toBe('x y\n');
  });
});
