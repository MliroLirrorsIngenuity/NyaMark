/**
 * `querySelector` for markup the caller rendered itself, where a miss is a
 * bug in that markup rather than a state to handle.
 */
export function requireElement<T extends Element = HTMLElement>(
  root: ParentNode,
  selector: string
): T {
  const element = root.querySelector<T>(selector);
  if (!element) throw new Error(`Missing element: ${selector}`);
  return element;
}
