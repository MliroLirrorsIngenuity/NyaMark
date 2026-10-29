import { i18next } from '../../i18n';
import {
  type ExportPdfDialog,
  type ExportPdfSettings,
  defaultPageSize,
} from '../../ui/export-pdf-dialog';
import { type FormEvent, type FormView, NativeForm } from './form';

const PAGE_SIZES = [
  ['Letter', 'dialog.exportPdf.pageSizes.letter'],
  ['A4', 'dialog.exportPdf.pageSizes.a4'],
  ['Legal', 'dialog.exportPdf.pageSizes.legal'],
] as const;

const MARGINS = [
  ['default', 'dialog.exportPdf.margins.default'],
  ['narrow', 'dialog.exportPdf.margins.narrow'],
  ['none', 'dialog.exportPdf.margins.none'],
  ['wide', 'dialog.exportPdf.margins.wide'],
] as const;

function exportView(settings: ExportPdfSettings, fileName: string): FormView {
  return {
    pages: [
      {
        id: 'export-pdf',
        title: i18next.t('dialog.exportPdf.title'),
        leading: { id: 'cancel', label: i18next.t('dialog.exportPdf.cancel') },
        trailing: {
          id: 'export',
          label: i18next.t('dialog.exportPdf.export'),
          role: 'primary',
        },
        sections: [
          {
            id: 'subtitle',
            rows: [
              {
                kind: 'note',
                id: 'subtitle',
                text: i18next.t('dialog.exportPdf.subtitle', { fileName }),
              },
            ],
          },
          {
            id: 'page',
            rows: [
              {
                kind: 'choice',
                id: 'pageSize',
                label: i18next.t('dialog.exportPdf.pageSize'),
                value: settings.pageSize,
                options: PAGE_SIZES.map(([value, label]) => ({
                  value,
                  label: i18next.t(label),
                })),
              },
              {
                kind: 'toggle',
                id: 'landscape',
                label: i18next.t('dialog.exportPdf.landscape'),
                value: settings.landscape,
              },
              {
                kind: 'choice',
                id: 'margin',
                label: i18next.t('dialog.exportPdf.margin'),
                value: settings.margin,
                options: MARGINS.map(([value, label]) => ({
                  value,
                  label: i18next.t(label),
                })),
              },
              {
                kind: 'slider',
                id: 'downscalePercent',
                label: i18next.t('dialog.exportPdf.downscale'),
                value: settings.downscalePercent,
                min: 70,
                max: 130,
                step: 5,
                valueText: `${settings.downscalePercent}%`,
              },
            ],
          },
        ],
      },
    ],
    height: 'medium',
    dismissible: true,
  };
}

/** The PDF export dialog in the native form, as `ExportPdfDialog` is on the page. */
export class NativeExportPdfDialog implements Pick<ExportPdfDialog, 'open'> {
  open(options: { fileName: string }): Promise<ExportPdfSettings | null> {
    return new Promise((resolve) => {
      let settings: ExportPdfSettings = {
        pageSize: defaultPageSize(),
        landscape: false,
        margin: 'default',
        downscalePercent: 100,
      };

      const finish = (value: ExportPdfSettings | null) => {
        form.hide();
        resolve(value);
      };

      const change = (id: string, value: boolean | string | number) => {
        switch (id) {
          case 'pageSize':
            settings = {
              ...settings,
              pageSize: value as ExportPdfSettings['pageSize'],
            };
            return;
          case 'landscape':
            settings = { ...settings, landscape: Boolean(value) };
            return;
          case 'margin':
            settings = {
              ...settings,
              margin: value as ExportPdfSettings['margin'],
            };
            return;
          case 'downscalePercent':
            settings = { ...settings, downscalePercent: Number(value) };
            return;
        }
      };

      const handle = (event: FormEvent) => {
        if (event.op === 'dismiss') finish(null);
        if (event.op === 'change') change(event.id, event.value);
        if (event.op !== 'press') return;
        if (event.id === 'cancel') finish(null);
        if (event.id === 'export') finish(settings);
      };

      const form = new NativeForm(
        'export-pdf',
        () => exportView(settings, options.fileName),
        handle
      );
      form.show();
    });
  }
}
