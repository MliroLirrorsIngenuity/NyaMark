import { beforeEach, describe, expect, mock, test } from 'bun:test';
import * as realUpdates from '../src/bridge/ipc/updates';
import type { FormPage, FormRow, FormView } from '../src/features/native/form';
import en from '../src/i18n/locales/en.json';
import * as realSettings from '../src/state/settings';
import type { SettingsPatch } from '../src/state/settings';

type Posted = {
  panel: string;
  op: string;
  form?: string;
  view?: FormView;
  [key: string]: unknown;
};

// The native side is a message handler on the window; Bun's global scope is
// an EventTarget, which the settings' subscriptions need.
const posted: Posted[] = [];
Object.assign(globalThis, {
  window: globalThis,
  __NYAMARK_PLATFORM__: 'ios',
  webkit: {
    messageHandlers: {
      nyamark: { postMessage: (m: Posted) => posted.push(m) },
    },
  },
  requestAnimationFrame: (run: () => void) => setTimeout(run, 0),
  cancelAnimationFrame: (id: number) => clearTimeout(id),
});

const saved: SettingsPatch[] = [];
const shownSettings = {
  ...structuredClone(realSettings.defaultSettings),
  general: { language: 'en' },
};

mock.module('../src/state/settings', () => ({
  ...realSettings,
  getSettings: () => shownSettings,
  updateSettings: async (patch: SettingsPatch) => {
    saved.push(patch);
  },
  previewAppearance: () => {},
}));

mock.module('../src/bridge/ipc/updates', () => ({
  ...realUpdates,
  currentVersion: async () => '1.2.3',
}));

const { i18next } = await import('../src/i18n');
await i18next.init({
  lng: 'en',
  resources: { en: { translation: en } },
  interpolation: { escapeValue: false },
});
const { dispatchPanel } = await import('../src/features/native/panels');
const { openNativeSettings } = await import('../src/features/native/settings');
const { NativeExportPdfDialog } = await import(
  '../src/features/native/export-pdf'
);
const { NativeImagePolicyDialog } = await import(
  '../src/features/native/image-policy'
);
const { defaultPageSize } = await import('../src/ui/export-pdf-dialog');

const send = (form: string, event: Record<string, unknown>) =>
  dispatchPanel({ type: 'panel', panel: 'form', form, ...event });

const shows = (form: string) =>
  posted.filter((m) => m.op === 'show' && m.form === form);

const lastView = (form: string) => {
  const view = shows(form).at(-1)?.view;
  if (!view) throw new Error(`${form} was not shown`);
  return view;
};

const rowsOf = (page: FormPage): FormRow[] =>
  page.sections.flatMap((section) => section.rows);

const rowNamed = (page: FormPage, id: string) =>
  rowsOf(page).find((row) => row.id === id);

const hidden = (form: string) =>
  posted.some((m) => m.op === 'hide' && m.form === form);

beforeEach(async () => {
  // A form a test left open would make the next open do nothing.
  await send('settings', { op: 'dismiss' });
  posted.length = 0;
  saved.length = 0;
});

describe('settings', () => {
  test('shows Cancel and OK, the two tabs and the current language', () => {
    openNativeSettings();
    const view = lastView('settings');
    const [page] = view.pages;
    expect(view.height).toBe('large');
    expect(view.dismissible).toBe(false);
    expect(page.id).toBe('settings');
    expect(page.title).toBe('Settings');
    expect(page.leading).toEqual({ id: 'cancel', label: 'Cancel' });
    expect(page.trailing).toEqual({ id: 'ok', label: 'OK', role: 'primary' });
    expect(page.tabs?.value).toBe('general');
    expect(page.tabs?.options.map((tab) => tab.value)).toEqual([
      'general',
      'ai',
    ]);
    expect(page.footer?.label).toBe('Reset to defaults');
    expect(rowNamed(page, 'general.language')).toMatchObject({
      kind: 'choice',
      value: 'en',
    });
  });

  test('leaves out what the web leaves out on a phone', () => {
    openNativeSettings();
    const ids = rowsOf(lastView('settings').pages[0]).map((row) => row.id);
    expect(ids).not.toContain('appearance.windowTransparency');
    expect(ids).not.toContain('save.autoSave');
    expect(ids).toContain('appearance.fontSize');
    expect(ids).toContain('attachments.insertPolicy');
  });

  test('opening again while shown shows nothing more', () => {
    openNativeSettings();
    openNativeSettings();
    expect(shows('settings')).toHaveLength(1);
  });

  test('a changed language is saved alone when OK is pressed', async () => {
    openNativeSettings();
    await send('settings', {
      op: 'change',
      page: 'settings',
      id: 'general.language',
      value: 'zh-CN',
    });
    await send('settings', { op: 'press', page: 'settings', id: 'ok' });
    expect(saved).toEqual([{ general: { language: 'zh-CN' } }]);
    expect(hidden('settings')).toBe(true);
  });

  test('Cancel saves nothing and closes', async () => {
    openNativeSettings();
    await send('settings', {
      op: 'change',
      page: 'settings',
      id: 'general.language',
      value: 'zh-CN',
    });
    await send('settings', { op: 'press', page: 'settings', id: 'cancel' });
    expect(saved).toEqual([]);
    expect(hidden('settings')).toBe(true);
  });

  test('a font size out of range is not taken', async () => {
    openNativeSettings();
    for (const value of [99, 16]) {
      await send('settings', {
        op: 'change',
        page: 'settings',
        id: 'appearance.fontSize',
        value,
      });
    }
    await send('settings', { op: 'press', page: 'settings', id: 'ok' });
    expect(saved).toEqual([{ appearance: { fontSize: 16 } }]);
  });

  test('the custom folder rows appear with the policy that uses them', async () => {
    openNativeSettings();
    const before = rowsOf(lastView('settings').pages[0]).map((row) => row.id);
    expect(before).not.toContain('attachments.chooseDirectory');
    await send('settings', {
      op: 'change',
      page: 'settings',
      id: 'attachments.insertPolicy',
      value: 'copy-custom-folder',
    });
    await new Promise((resolve) => setTimeout(resolve, 5));
    const after = rowsOf(lastView('settings').pages[0]).map((row) => row.id);
    expect(after).toContain('attachments.chooseDirectory');
    expect(after).not.toContain('attachments.clearDirectory');
  });
});

describe('PDF export', () => {
  test('resolves to the settings shown when Export is pressed', async () => {
    const result = new NativeExportPdfDialog().open({ fileName: 'Notes' });
    const view = lastView('export-pdf');
    const [page] = view.pages;
    expect(view.dismissible).toBe(true);
    expect(view.height).toBe('medium');
    expect(page.trailing?.label).toBe('Export to PDF');
    expect(rowNamed(page, 'pageSize')).toMatchObject({
      value: defaultPageSize(),
    });
    await send('export-pdf', {
      op: 'change',
      page: 'export-pdf',
      id: 'landscape',
      value: true,
    });
    await send('export-pdf', {
      op: 'change',
      page: 'export-pdf',
      id: 'downscalePercent',
      value: 85,
    });
    await send('export-pdf', { op: 'press', page: 'export-pdf', id: 'export' });
    expect(await result).toEqual({
      pageSize: defaultPageSize(),
      landscape: true,
      margin: 'default',
      downscalePercent: 85,
    });
    expect(hidden('export-pdf')).toBe(true);
  });

  test('resolves to null on dismiss and on Cancel', async () => {
    const dismissed = new NativeExportPdfDialog().open({ fileName: 'Notes' });
    await send('export-pdf', { op: 'dismiss' });
    expect(await dismissed).toBeNull();

    const cancelled = new NativeExportPdfDialog().open({ fileName: 'Notes' });
    await send('export-pdf', { op: 'press', page: 'export-pdf', id: 'cancel' });
    expect(await cancelled).toBeNull();
  });
});

describe('image questions', () => {
  test('the pasted image rule is the one chosen, remembered by default', async () => {
    const result = new NativeImagePolicyDialog().choosePastedImagePolicy({
      customDirectory: null,
      pickCustomDirectory: async () => null,
    });
    const [page] = lastView('image-policy').pages;
    expect(rowNamed(page, 'policy')).toMatchObject({
      kind: 'cards',
      value: 'copy-assets',
    });
    await send('image-policy', {
      op: 'change',
      page: 'image-policy',
      id: 'policy',
      value: 'base64',
    });
    await send('image-policy', { op: 'press', page: 'image-policy', id: 'ok' });
    expect(await result).toEqual({
      policy: 'base64',
      customDirectory: null,
      remember: true,
    });
  });

  test('a custom folder is asked for before OK takes it', async () => {
    const result = new NativeImagePolicyDialog().choosePastedImagePolicy({
      customDirectory: null,
      pickCustomDirectory: async () => '/photos',
    });
    await send('image-policy', {
      op: 'change',
      page: 'image-policy',
      id: 'policy',
      value: 'copy-custom-folder',
    });
    await send('image-policy', { op: 'press', page: 'image-policy', id: 'ok' });
    expect(hidden('image-policy')).toBe(false);
    await send('image-policy', { op: 'press', page: 'image-policy', id: 'ok' });
    expect(await result).toEqual({
      policy: 'copy-custom-folder',
      customDirectory: '/photos',
      remember: true,
    });
  });

  test('dismissing the rule question chooses nothing', async () => {
    const result = new NativeImagePolicyDialog().choosePastedImagePolicy({
      customDirectory: null,
      pickCustomDirectory: async () => null,
    });
    await send('image-policy', { op: 'dismiss' });
    expect(await result).toBeNull();
  });

  test('the unsaved document question answers with the button pressed', async () => {
    const dialog = new NativeImagePolicyDialog();
    const embedded = dialog.chooseUnsavedPastedImageAction();
    await send('image-unsaved', {
      op: 'press',
      page: 'image-unsaved',
      id: 'base64',
    });
    expect(await embedded).toBe('base64');

    const saved = dialog.chooseUnsavedPastedImageAction();
    await send('image-unsaved', {
      op: 'press',
      page: 'image-unsaved',
      id: 'save-document',
    });
    expect(await saved).toBe('save-document');

    const dismissed = dialog.chooseUnsavedPastedImageAction();
    await send('image-unsaved', { op: 'dismiss' });
    expect(await dismissed).toBe('cancel');
  });
});
