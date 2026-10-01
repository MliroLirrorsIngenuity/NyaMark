import { describe, expect, test } from 'bun:test';
import { defaultSettings, normalizeSettings } from '../src/state/settings';

describe('normalizeSettings', () => {
  test('falls back to defaults for missing or non-numeric numbers', () => {
    const settings = normalizeSettings({
      appearance: {
        fontSize: 'big',
        lineHeight: null,
        readableMaxWidth: 9999,
      },
      save: { autoSaveIntervalMs: Number.NaN },
    } as never);
    expect(settings.appearance.fontSize).toBe(
      defaultSettings.appearance.fontSize
    );
    expect(settings.appearance.lineHeight).toBe(
      defaultSettings.appearance.lineHeight
    );
    expect(settings.appearance.readableMaxWidth).toBe(1100);
    expect(settings.save.autoSaveIntervalMs).toBe(
      defaultSettings.save.autoSaveIntervalMs
    );
  });

  test('keeps only well-formed attachment settings', () => {
    const settings = normalizeSettings({
      attachments: {
        insertPolicy: 'upload-to-cloud',
        pastedImagePolicy: 'use-path',
        preferRelativePath: 'yes',
        escapePath: true,
        customCopyDirectory: '   ',
        extra: 1,
      },
    } as never);
    expect(settings.attachments).toEqual({
      ...defaultSettings.attachments,
      pastedImagePolicy: null,
      escapePath: true,
      customCopyDirectory: null,
    });
  });

  test('keeps valid attachment settings as they are', () => {
    const attachments = {
      insertPolicy: 'copy-custom-folder',
      pastedImagePolicy: 'base64',
      preferRelativePath: false,
      ensureDotSlash: true,
      escapePath: false,
      customCopyDirectory: '/tmp/images',
    } as const;
    expect(normalizeSettings({ attachments }).attachments).toEqual(attachments);
  });

  test('reads only real booleans as booleans', () => {
    const settings = normalizeSettings({
      save: { autoSave: 'false' },
      appearance: { windowTransparency: 1 },
    } as never);
    expect(settings.save.autoSave).toBe(defaultSettings.save.autoSave);
    expect(settings.appearance.windowTransparency).toBe(
      defaultSettings.appearance.windowTransparency
    );
  });
});
