import { chatMarkdownHtml, isOpenableLink } from '../../ai/render/markdown';

/** A run of text in a reply, with the marks on it. */
export type MdInline = {
  text: string;
  bold?: true;
  italic?: true;
  strike?: true;
  code?: true;
  /** TeX source of inline math. */
  math?: true;
  /** Where a link goes; only web and mail links are kept. */
  link?: string;
};

/** A reply's Markdown as the native chat draws it. */
export type MdBlock =
  | { kind: 'paragraph'; inlines: MdInline[] }
  | { kind: 'heading'; level: number; inlines: MdInline[] }
  | { kind: 'code'; language: string; text: string }
  | { kind: 'math'; text: string }
  | { kind: 'quote'; blocks: MdBlock[] }
  | {
      kind: 'list';
      ordered: boolean;
      start: number;
      items: Array<{ checked: boolean | null; blocks: MdBlock[] }>;
    }
  | {
      kind: 'table';
      align: Array<'left' | 'center' | 'right' | null>;
      head: MdInline[][];
      rows: MdInline[][][];
    }
  | { kind: 'rule' };

const ELEMENT_NODE = 1;
const TEXT_NODE = 3;

/** The characters HTML rendering folds into one space. */
const SPACE = new Set([' ', '\t', '\n', '\f', '\r']);

type Marks = Omit<MdInline, 'text'>;

const MARK_OF_TAG = new Map<string, 'bold' | 'italic' | 'strike' | 'code'>([
  ['strong', 'bold'],
  ['b', 'bold'],
  ['em', 'italic'],
  ['i', 'italic'],
  ['del', 'strike'],
  ['s', 'strike'],
  ['code', 'code'],
]);

const BLOCK_TAGS = new Set([
  'p',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'pre',
  'blockquote',
  'ul',
  'ol',
  'li',
  'table',
  'hr',
  'div',
  'section',
  'article',
  'aside',
  'details',
  'figure',
  'header',
  'footer',
  'main',
  'nav',
]);

const isElement = (node: Node): node is Element =>
  node.nodeType === ELEMENT_NODE;

/** The TeX a math element was written from, which KaTeX keeps in its MathML. */
function mathSource(element: Element): string {
  const source =
    element.querySelector('annotation') ??
    element.querySelector('.katex-error');
  return (source ?? element).textContent ?? '';
}

const sameMarks = (a: MdInline, b: MdInline) =>
  a.bold === b.bold &&
  a.italic === b.italic &&
  a.strike === b.strike &&
  a.code === b.code &&
  a.link === b.link &&
  !a.math &&
  !b.math;

/** The inline content of `nodes` as HTML shows it: white space folded, runs with the same marks joined. */
function inlinesOf(nodes: Iterable<Node>): MdInline[] {
  const pieces: MdInline[] = [];
  let atLineStart = true;
  let afterSpace = false;

  const dropTrailingSpace = () => {
    const last = pieces[pieces.length - 1];
    if (!last?.text.endsWith(' ')) return;
    last.text = last.text.slice(0, -1);
    if (!last.text) pieces.pop();
  };

  const addText = (raw: string, marks: Marks) => {
    let text = '';
    for (const char of raw) {
      if (SPACE.has(char)) {
        if (!atLineStart && !afterSpace) text += ' ';
        afterSpace = !atLineStart;
      } else {
        text += char;
        atLineStart = afterSpace = false;
      }
    }
    if (text) pieces.push({ text, ...marks });
  };

  const visit = (node: Node, marks: Marks) => {
    if (node.nodeType === TEXT_NODE) {
      addText(node.textContent ?? '', marks);
      return;
    }
    if (!isElement(node)) return;
    const tag = node.localName;
    if (tag === 'br') {
      dropTrailingSpace();
      pieces.push({ text: '\n', ...marks });
      atLineStart = true;
      afterSpace = false;
      return;
    }
    if (tag === 'input') return;
    if (node.classList.contains('math')) {
      pieces.push({ text: mathSource(node), ...marks, math: true });
      atLineStart = afterSpace = false;
      return;
    }
    let inner = marks;
    const mark = MARK_OF_TAG.get(tag);
    if (mark) inner = { ...marks, [mark]: true };
    const href = tag === 'a' ? node.getAttribute('href') : null;
    if (href && isOpenableLink(href)) inner = { ...inner, link: href };
    for (const child of Array.from(node.childNodes)) visit(child, inner);
  };

  for (const node of nodes) visit(node, {});

  while (pieces[pieces.length - 1]?.text === '\n') pieces.pop();
  dropTrailingSpace();

  const merged: MdInline[] = [];
  for (const piece of pieces) {
    const last = merged[merged.length - 1];
    if (last && sameMarks(last, piece)) last.text += piece.text;
    else merged.push(piece);
  }
  return merged;
}

const inlinesIn = (element: Element) =>
  inlinesOf(Array.from(element.childNodes));

function codeOf(pre: Element): MdBlock {
  const code = pre.querySelector('code');
  const tag = Array.from(code?.classList ?? []).find((name) =>
    name.startsWith('language-')
  );
  return {
    kind: 'code',
    language: tag?.slice('language-'.length) ?? '',
    text: (code ?? pre).textContent ?? '',
  };
}

function listOf(list: Element): MdBlock {
  const start = Number(list.getAttribute('start') ?? 1);
  const items = Array.from(list.children)
    .filter((child) => child.localName === 'li')
    .map((item) => {
      const box = item.querySelector('input[type="checkbox"]');
      const own = box?.closest('li') === item;
      return {
        checked: box && own ? box.hasAttribute('checked') : null,
        blocks: blocksOf(item),
      };
    });
  return {
    kind: 'list',
    ordered: list.localName === 'ol',
    start: Number.isFinite(start) ? start : 1,
    items,
  };
}

function tableOf(table: Element): MdBlock {
  const [headRow, ...bodyRows] = Array.from(table.querySelectorAll('tr'));
  const cellsOf = (row?: Element) =>
    Array.from(row?.children ?? []).filter(
      (cell) => cell.localName === 'th' || cell.localName === 'td'
    );
  const head = cellsOf(headRow);
  return {
    kind: 'table',
    align: head.map((cell) => {
      const align = cell.getAttribute('align');
      return align === 'left' || align === 'center' || align === 'right'
        ? align
        : null;
    }),
    head: head.map(inlinesIn),
    rows: bodyRows.map((row) => cellsOf(row).map(inlinesIn)),
  };
}

function blocksOfElement(element: Element): MdBlock[] {
  const tag = element.localName;
  switch (tag) {
    case 'p':
    case 'h1':
    case 'h2':
    case 'h3':
    case 'h4':
    case 'h5':
    case 'h6': {
      const inlines = inlinesIn(element);
      if (!inlines.length) return [];
      return tag === 'p'
        ? [{ kind: 'paragraph', inlines }]
        : [{ kind: 'heading', level: Number(tag.slice(1)), inlines }];
    }
    case 'pre':
      return [codeOf(element)];
    case 'blockquote':
      return [{ kind: 'quote', blocks: blocksOf(element) }];
    case 'ul':
    case 'ol':
      return [listOf(element)];
    case 'table':
      return [tableOf(element)];
    case 'hr':
      return [{ kind: 'rule' }];
    default:
      if (element.classList.contains('math-display')) {
        return [{ kind: 'math', text: mathSource(element) }];
      }
      return blocksOf(element);
  }
}

/** The blocks in `parent`; inline content outside a block element becomes a paragraph. */
function blocksOf(parent: Node): MdBlock[] {
  const blocks: MdBlock[] = [];
  let run: Node[] = [];
  const flush = () => {
    const inlines = inlinesOf(run);
    run = [];
    if (inlines.length) blocks.push({ kind: 'paragraph', inlines });
  };
  for (const node of Array.from(parent.childNodes)) {
    if (isElement(node) && BLOCK_TAGS.has(node.localName)) {
      flush();
      blocks.push(...blocksOfElement(node));
    } else {
      run.push(node);
    }
  }
  flush();
  return blocks;
}

/** A reply's Markdown as blocks, read from the panel's HTML before its sanitizer drops the task boxes. */
export function markdownBlocks(markdown: string): MdBlock[] {
  try {
    const template = document.createElement('template');
    template.innerHTML = chatMarkdownHtml(markdown);
    return blocksOf(template.content);
  } catch {
    return [{ kind: 'paragraph', inlines: [{ text: markdown }] }];
  }
}
