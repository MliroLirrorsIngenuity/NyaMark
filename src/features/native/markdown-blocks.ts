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

export function markdownBlocks(_markdown: string): MdBlock[] {
  return [];
}
