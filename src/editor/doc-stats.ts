import { Fragment, type Node } from '@milkdown/kit/prose/model';
import { alertMarkers } from './plugins/gfm-alerts';
import { countLines, countWords } from './text-stats';

export interface DocCounts {
  words: number;
  lines: number;
}

const MOST_REWRITTEN = 64;

export class DocStats {
  private readonly blockWords = new WeakMap<Node, number>();
  private readonly blockLines = new WeakMap<Node, number>();
  private counted: { doc: Node; sum: number } | null = null;

  constructor(private readonly write: (doc: Node) => string) {}

  count(doc: Node): DocCounts {
    return { words: this.words(doc), lines: this.lines(doc) };
  }

  private words(doc: Node): number {
    let words = 0;
    for (let index = 0; index < doc.childCount; index += 1) {
      const block = doc.child(index);
      let count = this.blockWords.get(block);
      if (count === undefined) {
        const alone = doc.copy(Fragment.from(block));
        const text = (from: number, to: number) =>
          alone.textBetween(from, to, '\n', ' ');
        count = countWords(text(0, alone.content.size));
        for (const { from, to } of alertMarkers(alone)) {
          count -= countWords(text(from, to));
        }
        this.blockWords.set(block, count);
      }
      words += count;
    }
    return words;
  }

  private lines(doc: Node): number {
    let last = doc.childCount - 1;
    while (last >= 0 && mayBeLeftOut(doc.child(last))) last -= 1;
    if (last < 0) {
      this.counted = null;
      return countLines(this.write(doc));
    }
    let end = doc.content.size;
    let endSum = 0;
    for (let index = doc.childCount - 1; index >= last; index -= 1) {
      const block = doc.child(index);
      end -= block.nodeSize;
      endSum += this.linesOf(block) + 1;
    }
    const endLines = countLines(this.write(doc.copy(doc.content.cut(end))));
    const sum = this.counted ? this.shifted(this.counted, doc) : null;
    if (sum == null) {
      const lines = countLines(this.write(doc));
      this.counted = { doc, sum: lines - endLines + endSum };
      return lines;
    }
    this.counted = { doc, sum };
    return sum - endSum + endLines;
  }

  private shifted(counted: { doc: Node; sum: number }, doc: Node) {
    const before = counted.doc;
    if (before === doc) return counted.sum;
    const shorter = Math.min(before.childCount, doc.childCount);
    let start = 0;
    while (start < shorter && before.child(start) === doc.child(start)) {
      start += 1;
    }
    let endBefore = before.childCount;
    let endNow = doc.childCount;
    while (
      endBefore > start &&
      endNow > start &&
      before.child(endBefore - 1) === doc.child(endNow - 1)
    ) {
      endBefore -= 1;
      endNow -= 1;
    }
    if (endBefore - start + (endNow - start) > MOST_REWRITTEN) return null;
    let { sum } = counted;
    for (let index = start; index < endBefore; index += 1) {
      sum -= this.linesOf(before.child(index)) + 1;
    }
    for (let index = start; index < endNow; index += 1) {
      sum += this.linesOf(doc.child(index)) + 1;
    }
    return sum;
  }

  private linesOf(block: Node): number {
    let lines = this.blockLines.get(block);
    if (lines === undefined) {
      const { schema } = block.type;
      const after = schema.nodes.paragraph.create(null, schema.text('x'));
      const alone = schema.topNodeType.create(null, [block, after]);
      lines = countLines(this.write(alone)) - 2;
      this.blockLines.set(block, lines);
    }
    return lines;
  }
}

function mayBeLeftOut(block: Node): boolean {
  if (block.type.name !== 'paragraph') return false;
  for (let index = 0; index < block.childCount; index += 1) {
    const inline = block.child(index);
    if (inline.isText ? /\S/.test(inline.text ?? '') : !isBreak(inline)) {
      return false;
    }
  }
  return true;
}

const isBreak = (inline: Node) => inline.type.name === 'hardbreak';
