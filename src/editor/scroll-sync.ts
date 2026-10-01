/**
 * Scroll sync between the source pane and the rendered preview. Headings
 * that appear on both sides pin the two scroll positions together; between
 * them the position is interpolated linearly.
 */

/** How far down the viewport the point kept in line on both sides sits. */
const SYNC_REFERENCE_RATIO = 0.28;

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

export function normalizeHeadingText(text: string) {
  const [firstLine] = text.trim().split(/\r?\n/);

  return firstLine
    .replace(/^#{1,6}\s*/, '')
    .replace(/\s+#+\s*$/, '')
    .replace(/`/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

export function buildScrollGuidePoints(
  fromAnchors: Array<{ key: string; top: number }>,
  toAnchors: Array<{ key: string; top: number }>,
  fromMax: number,
  toMax: number
) {
  if (fromMax <= 0 || toMax <= 0) return [{ fromTop: 0, toTop: 0 }];

  const points: ScrollGuidePoint[] = [{ fromTop: 0, toTop: 0 }];
  let lastToIndex = -1;

  for (const fromAnchor of fromAnchors) {
    const fromTop = clamp(fromAnchor.top, 0, fromMax);
    if (fromTop <= points[points.length - 1].fromTop) continue;

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
      if (fromTop <= points[points.length - 1].fromTop) continue;

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

export function mapViewportScrollTop(
  source: ScrollPane,
  target: ScrollPane,
  points: ScrollGuidePoint[]
) {
  const sourceReferenceTop =
    source.scrollTop + source.clientHeight * SYNC_REFERENCE_RATIO;
  const targetReferenceTop = mapScrollTop(sourceReferenceTop, points);
  const targetMax = Math.max(0, target.scrollHeight - target.clientHeight);

  return clamp(
    targetReferenceTop - target.clientHeight * SYNC_REFERENCE_RATIO,
    0,
    targetMax
  );
}
