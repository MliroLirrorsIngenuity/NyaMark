/**
 * The hunks that turn some blocks of the document into the blocks an edit
 * gives, each small enough to review alone. Blocks the two share are left
 * out; a paragraph or heading whose words changed gets a hunk for each run
 * of changed words, a block of blocks, a quote or a list, is gone through
 * block by block, and anything else (a table, a code block, an image) is
 * replaced whole.
 */

import { Fragment, type Node as ProseNode } from '@milkdown/kit/prose/model';
import { matchPairs } from '../../editor/myers';
import {
  nodesMatch,
  sameMarkupRelaxed,
} from '../../editor/plugins/ai-proposals';

export type HunkDraft = {
  from: number;
  to: number;
  insert: Fragment;
  kind: 'inline' | 'block';
};

/** Past this, two runs of blocks are taken as wholly different. */
const MAX_BLOCK_COST = 400;
const MAX_TOKEN_COST = 1000;
/** Cells of the table that pairs up changed blocks. */
const MAX_PAIRING = 40_000;
/** Words two blocks share, as a share of all, to be taken as one edited. */
const MIN_SIMILARITY = 0.4;
/** Past this share of its words changed, a block gets one hunk. */
const MAX_CHANGED = 0.6;

/**
 * Hunks turning the blocks `a`, the first at `start`, into `b`. `parent`
 * is the node holding `a`, to check each hunk leaves it valid.
 */
export function alignBlocks(
  a: readonly ProseNode[],
  start: number,
  b: readonly ProseNode[]
): HunkDraft[] {
  const pos = positions(a, start);
  const whole = (): HunkDraft[] =>
    a.length || b.length ? [blockHunk(pos, 0, a.length, b, 0, b.length)] : [];
  const pairs = matchPairs(a, b, nodesMatch, MAX_BLOCK_COST);
  if (!pairs) return whole();
  const out: HunkDraft[] = [];
  let i = 0;
  let j = 0;
  for (const [pi, pj] of [...pairs, [a.length, b.length] as const]) {
    if (pi > i || pj > j) out.push(...alignGap(a, pos, i, pi, b, j, pj));
    i = pi + 1;
    j = pj + 1;
  }
  return mergeTouching(out);
}

function positions(nodes: readonly ProseNode[], start: number) {
  const pos = [start];
  for (const node of nodes) pos.push(pos[pos.length - 1] + node.nodeSize);
  return pos;
}

function blockHunk(
  pos: readonly number[],
  i0: number,
  i1: number,
  b: readonly ProseNode[],
  j0: number,
  j1: number
): HunkDraft {
  return {
    from: pos[i0],
    to: pos[i1],
    insert: Fragment.fromArray(b.slice(j0, j1)),
    kind: 'block',
  };
}

/** Blocks `a[i0..i1)` against `b[j0..j1)`, none of which match. */
function alignGap(
  a: readonly ProseNode[],
  pos: readonly number[],
  i0: number,
  i1: number,
  b: readonly ProseNode[],
  j0: number,
  j1: number
): HunkDraft[] {
  const n = i1 - i0;
  const m = j1 - j0;
  if (n === 0 || m === 0 || n * m > MAX_PAIRING) {
    return [blockHunk(pos, i0, i1, b, j0, j1)];
  }
  const pairs = pairBlocks(a.slice(i0, i1), b.slice(j0, j1));
  const out: HunkDraft[] = [];
  let i = i0;
  let j = j0;
  for (const [pi, pj] of pairs) {
    const ai = i0 + pi;
    const bj = j0 + pj;
    if (ai > i || bj > j) out.push(blockHunk(pos, i, ai, b, j, bj));
    out.push(...refine(a[ai], pos[ai], b[bj]));
    i = ai + 1;
    j = bj + 1;
  }
  if (i1 > i || j1 > j) out.push(blockHunk(pos, i, i1, b, j, j1));
  return out;
}

/** Two blocks taken as one edited: the same markup changed within. */
function refine(x: ProseNode, pos: number, y: ProseNode): HunkDraft[] {
  if (nodesMatch(x, y)) return [];
  const whole: HunkDraft[] = [
    {
      from: pos,
      to: pos + x.nodeSize,
      insert: Fragment.from(y),
      kind: 'block',
    },
  ];
  if (!sameMarkupRelaxed(x, y)) return whole;
  if (x.isTextblock) {
    return x.type.spec.code ? whole : alignInline(x, pos + 1, y);
  }
  // A table lays out its rows and cells, which take no block between them.
  if (x.isLeaf || x.type.spec.tableRole) return whole;
  const hunks = alignBlocks(children(x), pos + 1, children(y));
  return fitsParent(x, pos + 1, hunks) ? hunks : whole;
}

function children(node: ProseNode): ProseNode[] {
  const list: ProseNode[] = [];
  for (let i = 0; i < node.childCount; i++) list.push(node.child(i));
  return list;
}

/**
 * Whether each hunk of `parent`'s own children, alone and all at once,
 * leaves it content its type allows: a list item starts with a paragraph.
 */
function fitsParent(
  parent: ProseNode,
  contentStart: number,
  hunks: readonly HunkDraft[]
): boolean {
  const own = hunks.filter(
    (hunk) =>
      hunk.kind === 'block' &&
      offsetIn(parent, hunk.from - contentStart) &&
      offsetIn(parent, hunk.to - contentStart)
  );
  const replace = (content: Fragment, list: readonly HunkDraft[]) => {
    let result = content;
    for (const hunk of [...list].sort((p, q) => q.from - p.from)) {
      result = result
        .cut(0, hunk.from - contentStart)
        .append(hunk.insert)
        .append(result.cut(hunk.to - contentStart));
    }
    return result;
  };
  for (const hunk of own) {
    if (!parent.type.validContent(replace(parent.content, [hunk]))) {
      return false;
    }
  }
  return (
    own.length < 2 || parent.type.validContent(replace(parent.content, own))
  );
}

/** Whether `offset` falls between two children of `parent`. */
function offsetIn(parent: ProseNode, offset: number) {
  let at = 0;
  for (let i = 0; i <= parent.childCount; i++) {
    if (at === offset) return true;
    if (at > offset || i === parent.childCount) return false;
    at += parent.child(i).nodeSize;
  }
  return false;
}

type Token = { from: number; to: number; key: string; text: string };

const CJK = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u;
const TOKEN =
  /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]|[\p{L}\p{N}\p{M}_]+|\s+|[\s\S]/gu;

/** The words, CJK characters, spaces and marks of a textblock's content. */
export function inlineTokens(content: Fragment): Token[] {
  const tokens: Token[] = [];
  content.forEach((node, offset) => {
    if (!node.isText) {
      const key = `\u0001${JSON.stringify(node.toJSON())}`;
      tokens.push({ from: offset, to: offset + node.nodeSize, key, text: '' });
      return;
    }
    const marks = node.marks.map((mark) => JSON.stringify(mark.toJSON()));
    const prefix = `${marks.join('|')}\u0000`;
    const text = node.text ?? '';
    for (const match of text.matchAll(TOKEN)) {
      const from = offset + (match.index ?? 0);
      tokens.push({
        from,
        to: from + match[0].length,
        key: prefix + match[0],
        text: match[0],
      });
    }
  });
  return tokens;
}

/** Text between two changes small enough to take them as one. */
function isGlue(tokens: readonly Token[]) {
  let solid = 0;
  for (const token of tokens) {
    if (/^\s+$/.test(token.text)) continue;
    // One CJK character or one mark of punctuation between two changes.
    if (
      token.text.length > 1 ||
      (!CJK.test(token.text) && /\w/.test(token.text))
    ) {
      return false;
    }
    solid++;
  }
  return solid <= 1;
}

/** Hunks for the runs of words that changed in a textblock. */
function alignInline(
  x: ProseNode,
  contentStart: number,
  y: ProseNode
): HunkDraft[] {
  const ta = inlineTokens(x.content);
  const tb = inlineTokens(y.content);
  const whole: HunkDraft[] = [
    {
      from: contentStart,
      to: contentStart + x.content.size,
      insert: y.content,
      kind: 'inline',
    },
  ];
  const pairs = matchPairs(ta, tb, (p, q) => p.key === q.key, MAX_TOKEN_COST);
  if (!pairs) return whole;
  const changed = ta.length + tb.length - 2 * pairs.length;
  if (changed > MAX_CHANGED * (ta.length + tb.length)) return whole;

  // The runs of tokens between the pairs, as [i0, i1) of `ta`, [j0, j1) of `tb`.
  const gaps: Array<[number, number, number, number]> = [];
  let i = 0;
  let j = 0;
  for (const [pi, pj] of [...pairs, [ta.length, tb.length] as const]) {
    if (pi > i || pj > j) {
      const last = gaps[gaps.length - 1];
      if (last && isGlue(ta.slice(last[1], i))) {
        last[1] = pi;
        last[3] = pj;
      } else {
        gaps.push([i, pi, j, pj]);
      }
    }
    i = pi + 1;
    j = pj + 1;
  }
  const at = (tokens: readonly Token[], index: number, size: number) =>
    index < tokens.length ? tokens[index].from : size;
  return gaps.map(([i0, i1, j0, j1]) => {
    const from = at(ta, i0, x.content.size);
    const to = i1 > i0 ? ta[i1 - 1].to : from;
    const bFrom = at(tb, j0, y.content.size);
    const bTo = j1 > j0 ? tb[j1 - 1].to : bFrom;
    return {
      from: contentStart + from,
      to: contentStart + to,
      insert: y.content.cut(bFrom, bTo),
      kind: 'inline' as const,
    };
  });
}

/** Counts of the words and CJK characters of a block's text. */
function wordCounts(node: ProseNode): Map<string, number> {
  const counts = new Map<string, number>();
  // Blocks within kept apart: a list's items ran into one word.
  const text = node.isLeaf
    ? ''
    : node.textBetween(0, node.content.size, ' ', ' ');
  for (const match of text.matchAll(TOKEN)) {
    if (/^\s+$/.test(match[0])) continue;
    counts.set(match[0], (counts.get(match[0]) ?? 0) + 1);
  }
  return counts;
}

/** Dice's coefficient over the two blocks' words. */
function similarity(
  x: ProseNode,
  y: ProseNode,
  cx: Map<string, number>,
  cy: Map<string, number>
): number {
  if (x.type !== y.type) return 0;
  let total = 0;
  for (const count of cx.values()) total += count;
  for (const count of cy.values()) total += count;
  if (total === 0) return 1;
  let shared = 0;
  for (const [word, count] of cx) shared += Math.min(count, cy.get(word) ?? 0);
  return (2 * shared) / total;
}

/**
 * Which blocks of `a` and `b` are one block edited, in order: the pairing
 * whose similarities add up highest, each at least `MIN_SIMILARITY`.
 */
function pairBlocks(
  a: readonly ProseNode[],
  b: readonly ProseNode[]
): Array<[number, number]> {
  const n = a.length;
  const m = b.length;
  const ca = a.map(wordCounts);
  const cb = b.map(wordCounts);
  const width = m + 1;
  const score = new Float64Array((n + 1) * width);
  const sims = new Float64Array(n * m);
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      const sim = similarity(a[i - 1], b[j - 1], ca[i - 1], cb[j - 1]);
      sims[(i - 1) * m + (j - 1)] = sim;
      let best = Math.max(score[(i - 1) * width + j], score[i * width + j - 1]);
      if (sim >= MIN_SIMILARITY) {
        best = Math.max(best, score[(i - 1) * width + j - 1] + sim);
      }
      score[i * width + j] = best;
    }
  }
  const pairs: Array<[number, number]> = [];
  let i = n;
  let j = m;
  while (i > 0 && j > 0) {
    const here = score[i * width + j];
    const sim = sims[(i - 1) * m + (j - 1)];
    if (
      sim >= MIN_SIMILARITY &&
      here === score[(i - 1) * width + j - 1] + sim
    ) {
      pairs.push([i - 1, j - 1]);
      i--;
      j--;
    } else if (here === score[(i - 1) * width + j]) {
      i--;
    } else {
      j--;
    }
  }
  return pairs.reverse();
}

/** Block hunks that meet, joined into one. */
function mergeTouching(hunks: readonly HunkDraft[]): HunkDraft[] {
  const out: HunkDraft[] = [];
  for (const hunk of hunks) {
    const last = out[out.length - 1];
    if (
      last?.kind === 'block' &&
      hunk.kind === 'block' &&
      last.to === hunk.from
    ) {
      out[out.length - 1] = {
        from: last.from,
        to: hunk.to,
        insert: last.insert.append(hunk.insert),
        kind: 'block',
      };
    } else {
      out.push(hunk);
    }
  }
  return out;
}
