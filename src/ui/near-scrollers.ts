/** The document's wide blocks that scroll sideways on a phone. */
const SCROLLERS =
  '.milkdown-table-block .table-wrapper, .milkdown-code-block .preview';

/** How long the document stays unchanged before its new wide blocks are looked for. */
const SCAN_DELAY_MS = 300;

/** Lets only the wide blocks within a screen of the visible part scroll sideways, as WebKit composites every scroller. */
export function bindNearScrollers(container: HTMLElement) {
  const observed = new Set<Element>();
  const near = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        entry.target.classList.toggle('ny-scroll-near', entry.isIntersecting);
      }
    },
    { rootMargin: '100% 0px' }
  );
  let timer = 0;
  const scan = () => {
    timer = 0;
    for (const element of observed) {
      if (element.isConnected) continue;
      near.unobserve(element);
      observed.delete(element);
    }
    for (const element of container.querySelectorAll(SCROLLERS)) {
      if (observed.has(element)) continue;
      observed.add(element);
      near.observe(element);
    }
  };
  const schedule = () => {
    window.clearTimeout(timer);
    timer = window.setTimeout(scan, SCAN_DELAY_MS);
  };
  const mutations = new MutationObserver(schedule);
  mutations.observe(container, { childList: true, subtree: true });
  scan();
  return () => {
    window.clearTimeout(timer);
    mutations.disconnect();
    near.disconnect();
  };
}
