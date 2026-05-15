import { ensureStyle } from '../style/register';
import { translateDOM } from '../i18n/dom';
import { i18next } from '../i18n';

export type ExportPdfSettings = {
  pageSize: 'Letter' | 'A4' | 'Legal';
  landscape: boolean;
  margin: 'default' | 'narrow' | 'none' | 'wide';
  downscalePercent: number;
};

const exportPdfDialogStyles = `
.ny-export-pdf-overlay {
  position: fixed;
  inset: 0;
  z-index: 140;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  background: color-mix(in srgb, var(--ny-app-bg-end), transparent 22%);
  backdrop-filter: blur(14px) saturate(1.08);
  -webkit-backdrop-filter: blur(14px) saturate(1.08);
  overflow-y: auto;
}

.ny-export-pdf-overlay[hidden] {
  display: none;
}

.ny-export-pdf-dialog {
  position: relative;
  width: min(760px, calc(100vw - 32px));
  padding: 28px 30px 24px;
  border: 1px solid var(--ny-border-strong);
  border-radius: 28px;
  background: var(--ny-surface-elevated);
  box-shadow: 0 32px 72px rgba(0, 0, 0, 0.22);
  color: var(--ny-text-primary);
  user-select: none;
  -webkit-user-select: none;
}

.ny-export-pdf-dialog__close {
  position: absolute;
  top: 14px;
  right: 14px;
  width: 32px;
  height: 32px;
  border: 1px solid color-mix(in srgb, var(--ny-border-strong), transparent 12%);
  border-radius: 999px;
  background: color-mix(in srgb, var(--ny-surface-muted), transparent 10%);
  color: var(--ny-text-secondary);
  font: inherit;
  cursor: default;
}

.ny-export-pdf-dialog__close:hover {
  color: var(--ny-text-primary);
  border-color: color-mix(in srgb, var(--ny-border-button-hover), transparent 12%);
}

.ny-export-pdf-dialog h3 {
  margin: 0 40px 8px 0;
  font-size: 20px;
  line-height: 1.2;
  font-weight: 760;
}

.ny-export-pdf-dialog__subtitle {
  margin: 0 0 18px;
  color: var(--ny-text-secondary);
  font-size: 13px;
  line-height: 1.5;
}

.ny-export-pdf-dialog__section {
  border-top: 1px solid color-mix(in srgb, var(--ny-border-strong), transparent 38%);
}

.ny-export-pdf-dialog__section:first-of-type {
  border-top: 0;
}

.ny-export-pdf-dialog__row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 20px;
  padding: 15px 0;
}

.ny-export-pdf-dialog__row-label {
  min-width: 0;
  color: var(--ny-text-primary);
  font-size: 14px;
  font-weight: 560;
}

.ny-export-pdf-dialog__hint {
  margin-top: 2px;
  color: var(--ny-text-secondary);
  font-size: 12px;
  line-height: 1.4;
}

.ny-export-pdf-dialog__control {
  flex-shrink: 0;
}

.ny-export-pdf-dialog__switch {
  appearance: none;
  position: relative;
  width: 38px;
  height: 22px;
  margin: 0;
  border: 1px solid color-mix(in srgb, var(--ny-border-strong), transparent 46%);
  border-radius: 999px;
  background: color-mix(in srgb, var(--ny-text-muted), transparent 82%);
  transition: background 0.18s ease, border-color 0.18s ease;
}

.ny-export-pdf-dialog__switch::after {
  content: "";
  position: absolute;
  top: 2px;
  left: 2px;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: #fff;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.12);
  transition: transform 0.18s ease;
}

.ny-export-pdf-dialog__switch:checked {
  background: var(--ny-accent);
  border-color: var(--ny-accent);
}

.ny-export-pdf-dialog__switch:checked::after {
  transform: translateX(16px);
}

.ny-export-pdf-dialog__select,
.ny-export-pdf-dialog__range {
  width: 220px;
}

.ny-export-pdf-dialog__select {
  padding: 9px 12px;
  border: 1px solid color-mix(in srgb, var(--ny-border-strong), transparent 16%);
  border-radius: 12px;
  background: color-mix(in srgb, var(--ny-surface-elevated), transparent 18%);
  color: var(--ny-text-primary);
  font: inherit;
}

.ny-export-pdf-dialog__range-wrap {
  display: flex;
  align-items: center;
  gap: 12px;
  width: 300px;
}

.ny-export-pdf-dialog__range {
  width: 220px;
}

.ny-export-pdf-dialog__range-value {
  min-width: 52px;
  color: var(--ny-text-primary);
  font-size: 13px;
  font-weight: 650;
  text-align: right;
}

.ny-export-pdf-dialog__footer {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  margin-top: 18px;
  padding-top: 16px;
  border-top: 1px solid color-mix(in srgb, var(--ny-border-strong), transparent 36%);
}

.ny-export-pdf-dialog__button {
  min-width: 100px;
  padding: 10px 16px;
  border: 1px solid color-mix(in srgb, var(--ny-border-strong), transparent 8%);
  border-radius: 999px;
  background: color-mix(in srgb, var(--ny-surface-elevated), transparent 10%);
  color: var(--ny-text-primary);
  font: inherit;
  cursor: default;
}

.ny-export-pdf-dialog__button--primary {
  background: color-mix(in srgb, var(--ny-accent), var(--ny-surface-elevated) 14%);
  border-color: color-mix(in srgb, var(--ny-accent), transparent 44%);
}

.ny-export-pdf-dialog__button:hover {
  border-color: color-mix(in srgb, var(--ny-accent), transparent 36%);
}

@media (max-width: 720px) {
  .ny-export-pdf-dialog__row {
    flex-direction: column;
    align-items: flex-start;
  }

  .ny-export-pdf-dialog__select,
  .ny-export-pdf-dialog__range-wrap {
    width: 100%;
  }

  .ny-export-pdf-dialog__footer {
    flex-direction: column-reverse;
  }

  .ny-export-pdf-dialog__button {
    width: 100%;
  }
}
`;

export class ExportPdfDialog {
  private readonly overlay: HTMLDivElement;

  constructor() {
    ensureStyle('export-pdf-dialog', exportPdfDialogStyles);
    this.overlay = document.createElement('div');
    this.overlay.className = 'ny-export-pdf-overlay';
    this.overlay.hidden = true;
    document.body.appendChild(this.overlay);
  }

  async open(options: { fileName: string }): Promise<ExportPdfSettings | null> {
    return await new Promise((resolve) => {
      this.overlay.innerHTML = '';
      this.overlay.hidden = false;

      const dialog = document.createElement('div');
      dialog.className = 'ny-export-pdf-dialog';
      dialog.setAttribute('role', 'dialog');
      dialog.setAttribute('aria-modal', 'true');
      dialog.setAttribute('aria-labelledby', 'ny-export-pdf-title');
      dialog.innerHTML = `
        <button type="button" class="ny-export-pdf-dialog__close" aria-label="Close">×</button>
        <h3 id="ny-export-pdf-title" data-i18n="dialog.exportPdf.title">Export to PDF</h3>
        <p class="ny-export-pdf-dialog__subtitle" data-i18n="dialog.exportPdf.subtitle">Export "Welcome" to PDF with the settings below.</p>

        <div class="ny-export-pdf-dialog__section">
          <div class="ny-export-pdf-dialog__row">
            <div>
              <div class="ny-export-pdf-dialog__row-label" data-i18n="dialog.exportPdf.pageSize">Page size</div>
            </div>
            <select class="ny-export-pdf-dialog__select">
              <option value="Letter" data-i18n="dialog.exportPdf.pageSizes.letter">Letter</option>
              <option value="A4" data-i18n="dialog.exportPdf.pageSizes.a4">A4</option>
              <option value="Legal" data-i18n="dialog.exportPdf.pageSizes.legal">Legal</option>
            </select>
          </div>
        </div>

        <div class="ny-export-pdf-dialog__section">
          <div class="ny-export-pdf-dialog__row">
            <div>
              <div class="ny-export-pdf-dialog__row-label" data-i18n="dialog.exportPdf.landscape">Landscape</div>
            </div>
            <input class="ny-export-pdf-dialog__switch" type="checkbox" />
          </div>
        </div>

        <div class="ny-export-pdf-dialog__section">
          <div class="ny-export-pdf-dialog__row">
            <div>
              <div class="ny-export-pdf-dialog__row-label" data-i18n="dialog.exportPdf.margin">Margin</div>
            </div>
            <select class="ny-export-pdf-dialog__select">
              <option value="default" data-i18n="dialog.exportPdf.margins.default">Default</option>
              <option value="narrow" data-i18n="dialog.exportPdf.margins.narrow">Narrow</option>
              <option value="none" data-i18n="dialog.exportPdf.margins.none">None</option>
              <option value="wide" data-i18n="dialog.exportPdf.margins.wide">Wide</option>
            </select>
          </div>
        </div>

        <div class="ny-export-pdf-dialog__section">
          <div class="ny-export-pdf-dialog__row">
            <div>
              <div class="ny-export-pdf-dialog__row-label" data-i18n="dialog.exportPdf.downscale">Downscale percent</div>
            </div>
            <div class="ny-export-pdf-dialog__range-wrap">
              <input class="ny-export-pdf-dialog__range" type="range" min="70" max="130" step="5" value="100" />
              <span class="ny-export-pdf-dialog__range-value">100%</span>
            </div>
          </div>
        </div>

        <div class="ny-export-pdf-dialog__footer">
          <button type="button" class="ny-export-pdf-dialog__button" data-action="cancel" data-i18n="dialog.exportPdf.cancel">Cancel</button>
          <button type="button" class="ny-export-pdf-dialog__button ny-export-pdf-dialog__button--primary" data-action="export" data-i18n="dialog.exportPdf.export">Export to PDF</button>
        </div>
      `;

      this.overlay.appendChild(dialog);
      translateDOM(this.overlay);

      const title = dialog.querySelector('#ny-export-pdf-title') as HTMLElement;
      const subtitle = dialog.querySelector(
        '.ny-export-pdf-dialog__subtitle'
      ) as HTMLElement;
      title.textContent = i18next.t('dialog.exportPdf.title');
      subtitle.textContent = i18next.t('dialog.exportPdf.subtitle', {
        fileName: options.fileName,
      });

      const close = dialog.querySelector(
        '.ny-export-pdf-dialog__close'
      ) as HTMLButtonElement;
      const pageSize = dialog.querySelector(
        '.ny-export-pdf-dialog__select'
      ) as HTMLSelectElement;
      const landscape = dialog.querySelector(
        '.ny-export-pdf-dialog__switch'
      ) as HTMLInputElement;
      const margin = dialog.querySelectorAll<HTMLSelectElement>(
        '.ny-export-pdf-dialog__select'
      )[1];
      const range = dialog.querySelector(
        '.ny-export-pdf-dialog__range'
      ) as HTMLInputElement;
      const rangeValue = dialog.querySelector(
        '.ny-export-pdf-dialog__range-value'
      ) as HTMLElement;
      const cancel = dialog.querySelector(
        '[data-action="cancel"]'
      ) as HTMLButtonElement;
      const confirm = dialog.querySelector(
        '[data-action="export"]'
      ) as HTMLButtonElement;

      const updateRange = () => {
        rangeValue.textContent = `${range.value}%`;
      };
      range.addEventListener('input', updateRange);
      updateRange();

      let settled = false;
      const cleanup = () => {
        if (settled) return;
        settled = true;
        this.overlay.removeEventListener('click', handleOverlayClick);
        this.overlay.hidden = true;
        this.overlay.innerHTML = '';
        document.removeEventListener('keydown', onKey, true);
      };

      const resolveAndClose = (value: ExportPdfSettings | null) => {
        cleanup();
        resolve(value);
      };

      const onKey = (event: KeyboardEvent) => {
        if (event.key === 'Escape') {
          event.preventDefault();
          resolveAndClose(null);
        }
      };

      const handleOverlayClick = (event: MouseEvent) => {
        if (event.target === this.overlay) {
          resolveAndClose(null);
        }
      };

      cancel.addEventListener('click', () => resolveAndClose(null));
      close.addEventListener('click', () => resolveAndClose(null));
      confirm.addEventListener('click', () => {
        resolveAndClose({
          pageSize: pageSize.value as ExportPdfSettings['pageSize'],
          landscape: landscape.checked,
          margin: margin.value as ExportPdfSettings['margin'],
          downscalePercent: Number(range.value),
        });
      });
      this.overlay.addEventListener('click', handleOverlayClick);
      document.addEventListener('keydown', onKey, true);

      pageSize.value = 'Letter';
      landscape.checked = false;
      margin.value = 'default';
    });
  }
}