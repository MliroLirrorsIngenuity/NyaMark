/**
 * The longest run of items two sequences share in order, found with Myers'
 * O(ND) difference algorithm. Generic over the items, as the proposals diff
 * both a document's blocks and the words of a paragraph.
 */

/** Index in `a`, index in `b`, of each item the two share, in order. */
export type Pairs = Array<[number, number]>;

/**
 * Pairs the items `a` and `b` share, or null when they differ in more than
 * `maxCost` insertions and deletions: the caller then takes them as wholly
 * different, which costs it less than the search would.
 */
export function matchPairs<T>(
  a: readonly T[],
  b: readonly T[],
  eq: (x: T, y: T) => boolean,
  maxCost = 1000
): Pairs | null {
  let start = 0;
  while (start < a.length && start < b.length && eq(a[start], b[start])) {
    start++;
  }
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && eq(a[endA - 1], b[endB - 1])) {
    endA--;
    endB--;
  }
  const middle = middlePairs(a, b, start, endA, start, endB, eq, maxCost);
  if (!middle) return null;
  const pairs: Pairs = [];
  for (let i = 0; i < start; i++) pairs.push([i, i]);
  pairs.push(...middle);
  for (let i = 0; i < a.length - endA; i++) pairs.push([endA + i, endB + i]);
  return pairs;
}

function middlePairs<T>(
  a: readonly T[],
  b: readonly T[],
  offA: number,
  endA: number,
  offB: number,
  endB: number,
  eq: (x: T, y: T) => boolean,
  maxCost: number
): Pairs | null {
  const n = endA - offA;
  const m = endB - offB;
  if (n === 0 || m === 0) return [];
  const same = (x: number, y: number) => eq(a[offA + x], b[offB + y]);
  const limit = Math.min(n + m, maxCost);
  // trace[d][k + d]: the furthest x on diagonal k after d edits.
  const trace: Int32Array[] = [];
  let found = -1;
  for (let d = 0; d <= limit && found < 0; d++) {
    const v = new Int32Array(2 * d + 1);
    const prev = trace[d - 1];
    for (let k = -d; k <= d; k += 2) {
      let x: number;
      if (d === 0) x = 0;
      else if (k === -d) x = prev[k + 1 + d - 1];
      else if (k === d) x = prev[k - 1 + d - 1] + 1;
      else {
        const down = prev[k + 1 + d - 1];
        const right = prev[k - 1 + d - 1] + 1;
        x = right > down ? right : down;
      }
      let y = x - k;
      while (x < n && y < m && same(x, y)) {
        x++;
        y++;
      }
      v[k + d] = x;
      if (x >= n && y >= m) found = d;
    }
    trace.push(v);
  }
  if (found < 0) return null;

  // Back from the end, collecting the diagonal runs.
  const pairs: Pairs = [];
  let x = n;
  let y = m;
  for (let d = found; d > 0; d--) {
    const prev = trace[d - 1];
    const k = x - y;
    let prevK: number;
    if (k === -d) prevK = k + 1;
    else if (k === d) prevK = k - 1;
    else {
      const down = prev[k + 1 + d - 1];
      const right = prev[k - 1 + d - 1] + 1;
      prevK = right > down ? k - 1 : k + 1;
    }
    const prevX = prev[prevK + d - 1];
    const prevY = prevX - prevK;
    while (x > prevX && y > prevY) {
      x--;
      y--;
      pairs.push([offA + x, offB + y]);
    }
    x = prevX;
    y = prevY;
  }
  while (x > 0 && y > 0) {
    x--;
    y--;
    pairs.push([offA + x, offB + y]);
  }
  return pairs.reverse();
}
