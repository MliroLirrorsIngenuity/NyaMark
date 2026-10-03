import { ensureStyle } from '../style/register';
import { animationsSettled } from './modal';

export type ToastKind = 'info' | 'warning';

/** How long a note stays up, longer for a warning to be read in full. */
const TOAST_DURATION_MS: Record<ToastKind, number> = {
  info: 3200,
  warning: 5200,
};

const ICONS: Record<ToastKind, string> = {
  info: '<circle cx="8" cy="8" r="6.25" /><path d="M5.5 8.2l1.7 1.7 3.3-3.6" />',
  warning:
    '<circle cx="8" cy="8" r="6.25" /><path d="M8 4.9v3.6" /><path d="M8 10.9v.1" />',
};

const toastStyles = `
.ny-toast {
  position: fixed;
  left: 50%;
  /* Above the status bar. */
  bottom: 48px;
  z-index: var(--ny-layer-toast);
  display: flex;
  align-items: flex-start;
  gap: 10px;
  box-sizing: border-box;
  max-width: min(420px, calc(100vw - 32px));
  padding: 10px 16px 10px 12px;
  border: 1px solid var(--ny-border-strong);
  border-radius: 14px;
  background: var(--ny-surface-elevated);
  backdrop-filter: blur(20px) saturate(1.2);
  -webkit-backdrop-filter: blur(20px) saturate(1.2);
  box-shadow: var(--ny-shadow-float);
  color: var(--ny-text-primary);
  font-size: 13px;
  line-height: 1.4;
  transform: translateX(-50%);
  user-select: none;
  -webkit-user-select: none;
  cursor: default;
  animation: ny-toast-in 220ms cubic-bezier(0.16, 1, 0.3, 1);
}

.ny-toast.is-leaving {
  pointer-events: none;
  animation: ny-toast-out 160ms ease-in forwards;
}

.ny-toast__icon {
  flex: none;
  width: 18px;
  height: 18px;
  color: var(--ny-accent);
}

.ny-toast--warning .ny-toast__icon {
  color: var(--ny-warning);
}

.ny-toast__text {
  display: grid;
  gap: 2px;
  min-width: 0;
}

.ny-toast__title {
  font-weight: 600;
}

.ny-toast__detail {
  color: var(--ny-text-secondary);
  font-size: 12px;
}

@keyframes ny-toast-in {
  from {
    opacity: 0;
    transform: translate(-50%, 8px) scale(0.98);
  }
}

@keyframes ny-toast-out {
  to {
    opacity: 0;
    transform: translate(-50%, 4px);
  }
}
`;

let shown: HTMLElement | null = null;

/**
 * A short note at the foot of the window that goes away by itself: held
 * while the pointer is on it, dismissed by a click. A new note takes the
 * place of the one showing.
 */
export function showToast(
  title: string,
  detail: string,
  kind: ToastKind = 'info'
): void {
  ensureStyle('ny-toast', toastStyles);
  shown?.remove();

  const toast = document.createElement('div');
  toast.className = `ny-toast ny-toast--${kind}`;
  toast.setAttribute('role', kind === 'warning' ? 'alert' : 'status');
  toast.innerHTML = `
    <svg class="ny-toast__icon" viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round">${ICONS[kind]}</svg>
    <div class="ny-toast__text">
      <span class="ny-toast__title"></span>
      <span class="ny-toast__detail"></span>
    </div>
  `;
  const titleElement = toast.querySelector<HTMLElement>('.ny-toast__title');
  const detailElement = toast.querySelector<HTMLElement>('.ny-toast__detail');
  if (titleElement) titleElement.textContent = title;
  if (detailElement) detailElement.textContent = detail;

  let timer = 0;
  const leave = async () => {
    window.clearTimeout(timer);
    if (toast.classList.contains('is-leaving')) return;
    toast.classList.add('is-leaving');
    await animationsSettled(toast);
    toast.remove();
    if (shown === toast) shown = null;
  };
  const wait = () => {
    window.clearTimeout(timer);
    timer = window.setTimeout(() => void leave(), TOAST_DURATION_MS[kind]);
  };
  toast.addEventListener('mouseenter', () => window.clearTimeout(timer));
  toast.addEventListener('mouseleave', wait);
  toast.addEventListener('click', () => void leave());

  document.body.append(toast);
  shown = toast;
  wait();
}
