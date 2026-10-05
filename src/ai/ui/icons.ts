/** Line icons for the assistant panel, drawn on a 16-unit grid. */

const svg = (body: string, extra = '') =>
  `<svg viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"${extra}>${body}</svg>`;

export const ICONS = {
  sparkle: svg(
    '<path d="M8 1.75c.4 2.9 1.35 3.85 4.25 4.25-2.9.4-3.85 1.35-4.25 4.25C7.6 7.35 6.65 6.4 3.75 6c2.9-.4 3.85-1.35 4.25-4.25Z" /><path d="M12.5 10.25c.18 1.3.6 1.72 1.75 1.9-1.15.18-1.57.6-1.75 1.9-.18-1.3-.6-1.72-1.75-1.9 1.15-.18 1.57-.6 1.75-1.9Z" />'
  ),
  newChat: svg(
    '<path d="M13.25 8.5v3.75a1 1 0 0 1-1 1h-8.5a1 1 0 0 1-1-1v-8.5a1 1 0 0 1 1-1H7.5" /><path d="M12.25 1.75l2 2L9 9H7V7l5.25-5.25Z" />'
  ),
  close: svg('<path d="M4 4l8 8M12 4l-8 8" />'),
  chevron: svg('<path d="M4.5 6.25 8 9.75l3.5-3.5" />'),
  chevronUp: svg('<path d="M4.5 9.75 8 6.25l3.5 3.5" />'),
  send: svg('<path d="M8 13V3.5M3.75 7.5 8 3.25l4.25 4.25" />'),
  stop: svg(
    '<rect x="4.5" y="4.5" width="7" height="7" rx="1.25" fill="currentColor" stroke="none" />'
  ),
  copy: svg(
    '<rect x="5.25" y="5.25" width="8" height="8" rx="1.5" /><path d="M10.75 5.25V3.75a1 1 0 0 0-1-1h-6a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h1.5" />'
  ),
  check: svg('<path d="M3.5 8.5 6.5 11.5 12.5 4.5" />'),
  retry: svg(
    '<path d="M13 8a5 5 0 1 1-1.46-3.54" /><path d="M13.25 2.5v2.75H10.5" />'
  ),
  down: svg('<path d="M8 3.5V12.5M3.75 8.25 8 12.5l4.25-4.25" />'),
  alert: svg(
    '<circle cx="8" cy="8" r="5.75" /><path d="M8 5v3.25" /><path d="M8 10.9v.1" />'
  ),
  dash: svg('<path d="M4.75 8h6.5" />'),
  image: svg(
    '<rect x="2.25" y="3" width="11.5" height="10" rx="1.5" /><circle cx="5.75" cy="6.25" r="1.1" /><path d="m2.75 11.75 3.5-3.5 2.5 2.5 1.75-1.75 2.75 2.75" />'
  ),
};
