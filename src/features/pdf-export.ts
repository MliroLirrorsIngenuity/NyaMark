import { printCurrentWindow } from '../bridge/ipc/windows';
import { store } from '../state/store';
import { documentFileName } from '../ui/document-name';
import {
  ExportPdfDialog,
  type ExportPdfSettings,
} from '../ui/export-pdf-dialog';
import printStyles from '../ui/print.css?inline';

const PAGE_MARGINS: Record<ExportPdfSettings['margin'], string> = {
  none: '0',
  narrow: '8mm',
  default: '16mm',
  wide: '24mm',
};

/**
 * Export to PDF through the system print dialog: the export dialog picks the
 * page, then the document alone is laid out for print until printing ends.
 */
export class PdfExporter {
  private readonly dialog = new ExportPdfDialog();
  private busy = false;

  /**
   * Asked again while the dialog is open or printing runs, it stays with
   * the one under way: a second dialog over the first left the first one's
   * keys bound once both closed, and Tab and Escape went to nothing.
   */
  async open() {
    if (this.busy) return;
    this.busy = true;
    try {
      const settings = await this.dialog.open({ fileName: printableTitle() });
      if (settings) await exportAsPdf(settings);
    } finally {
      this.busy = false;
    }
  }
}

function printableTitle() {
  const stem = (name: string) => name.replace(/\.[^.]+$/, '');
  return (
    stem(documentFileName(store.getState().filePath)) ||
    stem(documentFileName(null))
  );
}

function nextFrame() {
  return new Promise<void>((resolve) => {
    requestAnimationFrame(() => resolve());
  });
}

async function exportAsPdf(settings: ExportPdfSettings) {
  const previousSourceMode = store.getState().sourceMode;
  if (previousSourceMode) {
    store.update({ sourceMode: false });
    await nextFrame();
  }

  const root = document.documentElement;
  root.classList.add('ny-exporting-pdf');
  // The page prints in the light theme: white paper keeps the colours as
  // they are (print-color-adjust), and the dark theme's pale ink on it all
  // but vanished.
  const theme = {
    name: root.dataset.theme,
    dark: root.classList.contains('dark'),
    scheme: root.style.colorScheme,
  };
  root.dataset.theme = 'light';
  root.classList.remove('dark');
  root.style.colorScheme = 'light';

  const previousZoom = document.body.style.zoom;
  const printStyle = document.createElement('style');
  printStyle.id = 'ny-print-export-style';
  printStyle.textContent = `${pageRule(settings)}\n${printStyles}`;
  document.head.appendChild(printStyle);

  document.body.style.zoom =
    settings.downscalePercent !== 100
      ? String(settings.downscalePercent / 100)
      : '';

  let restored = false;
  const restore = () => {
    if (restored) return;
    restored = true;
    for (const type of ['afterprint', 'pointerdown', 'keydown']) {
      window.removeEventListener(type, restore, true);
    }
    printStyle.remove();
    document.body.style.zoom = previousZoom;
    root.classList.remove('ny-exporting-pdf');
    if (theme.name === undefined) delete root.dataset.theme;
    else root.dataset.theme = theme.name;
    root.classList.toggle('dark', theme.dark);
    root.style.colorScheme = theme.scheme;
    if (previousSourceMode) {
      store.update({ sourceMode: true });
    }
  };

  // WebKit (the native print sheet included) and Chromium fire afterprint
  // once printing is over. Input reaching the page is the backstop: the
  // print dialog is modal, so the page only sees input once it is gone.
  window.addEventListener('afterprint', restore, true);
  await nextFrame();
  window.addEventListener('pointerdown', restore, true);
  window.addEventListener('keydown', restore, true);

  try {
    await printCurrentWindow();
  } catch (error) {
    console.warn(
      '[export] Native print failed, falling back to browser print',
      error
    );
    window.print();
  }
}

function pageRule(settings: ExportPdfSettings) {
  const pageSize = settings.pageSize.toLowerCase();
  const orientation = settings.landscape ? 'landscape' : 'portrait';
  return `@page {
  size: ${pageSize} ${orientation};
  margin: ${PAGE_MARGINS[settings.margin]};
}`;
}
