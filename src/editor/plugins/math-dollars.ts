/**
 * Dollars that hold no math: `价格 $5 和 $10`, `echo $HOME and $PATH`.
 *
 * Any two dollars in a paragraph made inline math, so the text between two
 * prices turned into a formula, "5 和 ", when the file was opened, and the
 * same happened as the second one was typed. Math between dollars starts and
 * ends with something other than a space, as Pandoc and Typora read it;
 * dollars around a space at either end stay text, both typed and opened.
 * Dollars typed in inline code stay text as well.
 *
 * Saving such a paragraph writes its dollars as they were typed: see
 * `markdown-output`, where remark would escape every one of them.
 */

import { InputRule, inputRules } from '@milkdown/kit/prose/inputrules';
import type { EditorState } from '@milkdown/kit/prose/state';
import { $prose, $remark } from '@milkdown/kit/utils';
import type { Processor } from 'unified';

type MdNode = {
  type: string;
  value?: string;
  position?: { start: { offset?: number }; end: { offset?: number } };
  children?: MdNode[];
};

/** Whether the text between two dollars is read as text: a space at an end. */
export function isDollarText(between: string): boolean {
  return /^\s|\s$/.test(between);
}

/** Crepe's rule for inline math, as the closing dollar is typed. */
export const TYPED_MATH = /\$([^$]+)\$$/;

/** The closing dollar typed as text when what it closes is no math, or code. */
export function keepDollar(
  state: EditorState,
  match: RegExpMatchArray,
  start: number,
  end: number
) {
  const [typed, between = ''] = match;
  // Typed into inline code, Crepe made math of it there too.
  const marks = state.storedMarks ?? state.doc.resolve(end).marks();
  const inCode = marks.some((mark) => mark.type.spec.code);
  if (!inCode && !isDollarText(between)) return null;
  return state.tr.insertText('$', start + typed.length - 1, end);
}

export const dollarInput = $prose(() =>
  inputRules({ rules: [new InputRule(TYPED_MATH, keepDollar)] })
);

/**
 * What the dollars and the text between them read as, the math left out.
 * The math had taken any emphasis or link in there along with the text.
 */
function readAsText(processor: Processor, written: string): MdNode[] | null {
  // Escaped, the dollars open no math, and keep the spaces next to them in
  // the paragraph they make.
  const escaped = `\\$${written.slice(1, -1)}\\$`;
  const root = processor.parse(escaped) as MdNode;
  const paragraph = root.children?.[0];
  if (root.children?.length !== 1 || paragraph?.type !== 'paragraph') {
    return null;
  }
  return paragraph.children ?? null;
}

/** Remark transformer: inline math that reads as text turned back into it. */
export function dollarText(this: Processor) {
  return (tree: MdNode, file: { value?: unknown }) => {
    const source = typeof file.value === 'string' ? file.value : '';
    const visit = (node: MdNode) => {
      const children = node.children ?? [];
      for (let index = 0; index < children.length; index += 1) {
        const child = children[index];
        if (child?.type !== 'inlineMath' || !isDollarText(child.value ?? '')) {
          if (child) visit(child);
          continue;
        }
        const start = child.position?.start.offset;
        const end = child.position?.end.offset;
        // The dollars as written, padding and all, unless the math ran over
        // lines, where the source holds quote markers too.
        const written =
          start !== undefined && end !== undefined
            ? source.slice(start, end)
            : '';
        const read =
          written.startsWith('$') && !written.includes('\n')
            ? readAsText(this, written)
            : null;
        const text = read ?? [{ type: 'text', value: `$${child.value}$` }];
        children.splice(index, 1, ...text);
        index += text.length - 1;
      }
    };
    visit(tree);
  };
}

export const dollarTextParse = $remark('nyamark-dollar-text', () => dollarText);
