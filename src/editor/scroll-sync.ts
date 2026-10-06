/**
 * Scroll sync between the source pane and the rendered preview. Headings
 * that appear on both sides pin the two scroll positions together; between
 * them the position is interpolated linearly. Everything here works in
 * scroll positions, so the panes reach their top and bottom together.
 */

import type { Nodes } from 'mdast';
import { toString as plainText } from 'mdast-util-to-string';

/** How far down the viewport a shared heading lines up in both panes. */
const SYNC_REFERENCE_RATIO = 0.28;

export type ScrollAnchor = {
  key: string;
  top: number;
};

export type ScrollGuidePoint = {
  fromTop: number;
  toTop: number;
};

type ScrollPane = Pick<
  HTMLElement,
  'scrollTop' | 'clientHeight' | 'scrollHeight'
>;

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

export function headingKey(heading: Nodes | string) {
  const text =
    typeof heading === 'string'
      ? heading
      : plainText(heading, { includeImageAlt: false, includeHtml: false });
  return text.replace(/\s+/g, ' ').trim().toLowerCase();
}

/**
 * Pairs of scroll positions that belong together, rising on both sides,
 * from both tops to both ends. An anchor's `top` is the scroll position at
 * which it is in line; one that only fits at the very end is left out, as
 * the end itself has to stay paired with the other end.
 */
export function buildScrollGuidePoints(
  fromAnchors: ScrollAnchor[],
  toAnchors: ScrollAnchor[],
  fromMax: number,
  toMax: number
) {
  if (fromMax <= 0 || toMax <= 0) return [{ fromTop: 0, toTop: 0 }];

  const points: ScrollGuidePoint[] = [{ fromTop: 0, toTop: 0 }];
  let lastToIndex = -1;

  for (const fromAnchor of fromAnchors) {
    const fromTop = clamp(fromAnchor.top, 0, fromMax);
    if (fromTop <= points[points.length - 1].fromTop || fromTop >= fromMax) {
      continue;
    }

    const toIndex = toAnchors.findIndex(
      (toAnchor, index) =>
        index > lastToIndex && toAnchor.key === fromAnchor.key
    );
    if (toIndex < 0) continue;

    lastToIndex = toIndex;

    points.push({
      fromTop,
      toTop: clamp(toAnchors[toIndex].top, 0, toMax),
    });
  }

  if (points.length === 1) {
    const count = Math.min(fromAnchors.length, toAnchors.length);
    for (let index = 0; index < count; index += 1) {
      const fromTop = clamp(fromAnchors[index].top, 0, fromMax);
      if (fromTop <= points[points.length - 1].fromTop || fromTop >= fromMax) {
        continue;
      }

      points.push({
        fromTop,
        toTop: clamp(toAnchors[index].top, 0, toMax),
      });
    }
  }

  const lastPoint = points[points.length - 1];
  if (lastPoint.fromTop < fromMax || lastPoint.toTop < toMax) {
    points.push({ fromTop: fromMax, toTop: toMax });
  }

  return points;
}

export function mapScrollTop(scrollTop: number, points: ScrollGuidePoint[]) {
  if (points.length === 0) return 0;
  if (points.length === 1) return points[0].toTop;

  const lastPoint = points[points.length - 1];
  const x = clamp(scrollTop, 0, lastPoint.fromTop);

  let current = points[0];
  for (let index = 1; index < points.length; index += 1) {
    const next = points[index];
    if (x <= next.fromTop) {
      const span = next.fromTop - current.fromTop;
      const ratio = span <= 0 ? 0 : (x - current.fromTop) / span;
      return current.toTop + ratio * (next.toTop - current.toTop);
    }

    current = next;
  }

  return lastPoint.toTop;
}

function maxScrollTop(pane: ScrollPane) {
  return Math.max(0, pane.scrollHeight - pane.clientHeight);
}

/**
 * Where `target` should scroll to follow `source`. The anchors are content
 * offsets of the headings in each pane; each becomes the scroll position
 * that puts its heading on the reference line.
 */
export function syncedScrollTop(
  source: ScrollPane,
  target: ScrollPane,
  sourceAnchors: ScrollAnchor[],
  targetAnchors: ScrollAnchor[]
) {
  const inLine = (anchors: ScrollAnchor[], pane: ScrollPane) =>
    anchors.map((anchor) => ({
      key: anchor.key,
      top: anchor.top - pane.clientHeight * SYNC_REFERENCE_RATIO,
    }));
  const points = buildScrollGuidePoints(
    inLine(sourceAnchors, source),
    inLine(targetAnchors, target),
    maxScrollTop(source),
    maxScrollTop(target)
  );
  return mapScrollTop(source.scrollTop, points);
}
