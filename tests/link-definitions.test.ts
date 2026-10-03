import { describe, expect, test } from 'bun:test';
import remarkInlineLinks from 'remark-inline-links';
import remarkParse from 'remark-parse';
import remarkStringify from 'remark-stringify';
import { unified } from 'unified';
import { keepUnusedDefinitions } from '../src/editor/plugins/link-definitions';

type Tree = { type: string; value?: string; children?: Tree[] };

/** Read as the editor reads it: the definitions links use go into them. */
function read(markdown: string) {
  const processor = unified()
    .use(remarkParse)
    .use(keepUnusedDefinitions)
    .use(remarkInlineLinks);
  return processor.runSync(processor.parse(markdown), markdown) as Tree;
}

const resave = (markdown: string) =>
  unified()
    .use(remarkStringify)
    .stringify(read(markdown) as never);

const kept = (markdown: string) => {
  const values: string[] = [];
  const walk = (node: Tree) => {
    if (node.type === 'html' && node.value) values.push(node.value);
    for (const child of node.children ?? []) walk(child);
  };
  walk(read(markdown));
  return values;
};

describe('link definitions', () => {
  test('keep one no link uses as written', () => {
    expect(
      kept(
        'Text [used][a].\n\n[a]: https://a.example\n[spare]: <my file.md> "kept"\n'
      )
    ).toEqual(['[spare]: <my file.md> "kept"']);
  });

  test('let the one a link uses go into the link', () => {
    expect(resave('[used][a]\n\n[a]: https://a.example\n')).toBe(
      '[used](https://a.example)\n'
    );
  });

  test('keep a second definition of a label', () => {
    expect(kept('[x]\n\n[x]: /first\n[x]: /second\n')).toEqual([
      '[x]: /second',
    ]);
  });

  test('match labels as references do, case and spacing aside', () => {
    expect(kept('[Some  Label]\n\n[some label]: /a\n')).toEqual([]);
  });

  test('write one spread over lines on one line', () => {
    expect(kept('> [q]:\n> /a\n> "t"\n')).toEqual(['[q]: /a "t"']);
  });

  test('read the kept ones back as definitions', () => {
    const saved = resave(
      '# T\n\n[a]: https://a.example "A"\n[b]: <with space.md>\n\n- item\n\n  [c]: /c\n'
    );
    expect(saved).toContain('[a]: https://a.example "A"');
    expect(saved).toContain('[b]: <with space.md>');
    expect(saved).toContain('[c]: /c');
    const again = unified().use(remarkParse).parse(saved) as Tree;
    const definitions: string[] = [];
    const walk = (node: Tree) => {
      if (node.type === 'definition') definitions.push(node.type);
      for (const child of node.children ?? []) walk(child);
    };
    walk(again);
    expect(definitions).toHaveLength(3);
  });
});
