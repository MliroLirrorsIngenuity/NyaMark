const registeredStyles = new Set<string>();

export function ensureStyle(id: string, css: string) {
  if (registeredStyles.has(id)) return;

  const style = document.createElement('style');
  style.dataset.nyamarkStyle = id;
  style.textContent = css;
  document.head.appendChild(style);
  registeredStyles.add(id);
}
