import { errorDialog, openDirectoryDialog } from '../../bridge/ipc/files';
import { currentVersion } from '../../bridge/ipc/updates';
import { i18next } from '../../i18n';
import type {
  ImageInsertPolicy,
  ImageSettings,
} from '../../state/image-settings';
import {
  type AppearanceSettings,
  type Settings,
  changedSettings,
  getSettings,
  previewAppearance,
  resetSettings,
  sanitizeAppearanceSettings,
  updateSettings,
} from '../../state/settings';
import { THEMES } from '../../ui/settings-panel/sections/appearance';
import { POLICIES } from '../../ui/settings-panel/sections/attachments';
import { LANGUAGES } from '../../ui/settings-panel/sections/general';
import {
  type FormEvent,
  type FormOption,
  type FormPage,
  type FormRow,
  type FormSection,
  type FormView,
  NativeForm,
  registerFormOpener,
} from './form';
import type { NativeAiTab } from './settings-ai';

export type NativeSettingsTab = 'general' | 'ai';

const TABS: readonly NativeSettingsTab[] = ['general', 'ai'];

/** Pause after the last change in the appearance before it is shown on the page. */
const PREVIEW_DELAY_MS = 180;

const APPEARANCE_NUMBERS = [
  {
    key: 'fontSize',
    label: 'settings.appearance.fontSize',
    min: 11,
    max: 22,
    step: 1,
  },
  {
    key: 'lineHeight',
    label: 'settings.appearance.lineHeight',
    min: 1.2,
    max: 2.2,
    step: 0.01,
  },
  {
    key: 'readableMaxWidth',
    label: 'settings.appearance.readableWidth',
    min: 520,
    max: 1100,
    step: 10,
  },
] as const;

const ATTACHMENT_SWITCHES = [
  {
    key: 'preferRelativePath',
    label: 'settings.attachments.preferRelativePath',
  },
  { key: 'ensureDotSlash', label: 'settings.attachments.ensureDotSlash' },
  { key: 'escapePath', label: 'settings.attachments.escapePath' },
] as const;

/** The insert policies as the form's options, named as the settings name them. */
export function policyOptions(
  policies: readonly ImageInsertPolicy[]
): FormOption[] {
  return policies.map((value) => ({
    value,
    label: i18next.t(`settings.attachments.policies.${value}.label`),
    detail: i18next.t(`settings.attachments.policies.${value}.description`),
  }));
}

/**
 * The settings in the native form, as `SettingsPanel` is on the page: edits
 * stay in a working copy until OK writes what changed.
 */
class NativeSettings {
  readonly form = new NativeForm(
    'settings',
    () => this.view(),
    (event) => this.handle(event)
  );
  private readonly opened = structuredClone(getSettings());
  private working: Settings = structuredClone(this.opened);
  private tab: NativeSettingsTab;
  private version = '';
  /** The ids of the pages the AI tab pushed, from the first to the one shown. */
  private stack: string[] = [];
  private previewTimer: number | null = null;
  private closing = false;
  private aiLoaded: Promise<void> | null = null;
  private aiTab: NativeAiTab | null = null;
  /** Keys typed in the AI tab, held until OK keeps them or the dialog goes. */
  private secretsSettled = false;
  private readonly refresh = () => this.form.refresh();

  constructor(tab: NativeSettingsTab, addService?: string) {
    this.tab = tab;
    currentVersion()
      .then((version) => {
        this.version = version;
        this.refresh();
      })
      .catch(console.error);
    i18next.on('languageChanged', this.refresh);
    this.form.show();
    if (tab === 'ai') {
      this.loadAi().then(
        () => {
          if (addService) this.aiTab?.addService(addService);
        },
        () => undefined
      );
    }
  }

  private view(): FormView {
    return {
      pages: [this.firstPage(), ...this.pushedPages()],
      height: 'large',
      dismissible: false,
    };
  }

  private firstPage(): FormPage {
    return {
      id: 'settings',
      title: i18next.t('settings.title'),
      leading: { id: 'cancel', label: i18next.t('settings.cancel') },
      trailing: {
        id: 'ok',
        label: i18next.t('settings.ok'),
        role: 'primary',
      },
      tabs: {
        value: this.tab,
        options: TABS.map((value) => ({
          value,
          label: i18next.t(`settings.tabs.${value}`),
        })),
      },
      sections:
        this.tab === 'ai'
          ? (this.aiTab?.sections() ?? [])
          : this.generalSections(),
      footer: {
        id: 'reset',
        label: i18next.t('settings.reset'),
        role: 'destructive',
      },
    };
  }

  private pushedPages(): FormPage[] {
    const pages = new Map<string, FormPage>();
    for (const id of this.stack) {
      const page = this.aiTab?.page(id);
      if (page) pages.set(id, page);
    }
    this.stack = [...pages.keys()];
    return [...pages.values()];
  }

  private generalSections(): FormSection[] {
    const { general, appearance, attachments } = this.working;
    return [
      {
        id: 'general',
        title: i18next.t('settings.general.title'),
        rows: [
          {
            kind: 'choice',
            id: 'general.language',
            label: i18next.t('settings.general.language'),
            value: general.language,
            options: LANGUAGES.map(({ value, label, i18n }) => ({
              value,
              label: i18n ? i18next.t(i18n) : label,
            })),
          },
          {
            kind: 'value',
            id: 'general.version',
            label: i18next.t('settings.general.version'),
            value: this.version,
          },
        ],
      },
      {
        id: 'appearance',
        title: i18next.t('settings.appearance.title'),
        rows: [
          {
            kind: 'choice',
            id: 'appearance.theme',
            label: i18next.t('settings.appearance.theme'),
            value: appearance.theme,
            options: THEMES.map(({ value, i18n }) => ({
              value,
              label: i18next.t(i18n),
            })),
          },
          ...APPEARANCE_NUMBERS.map(
            ({ key, label, min, max, step }): FormRow => ({
              kind: 'number',
              id: `appearance.${key}`,
              label: i18next.t(label),
              value: appearance[key],
              min,
              max,
              step,
            })
          ),
        ],
      },
      {
        id: 'attachments',
        title: i18next.t('settings.attachments.title'),
        rows: this.attachmentRows(attachments),
      },
    ];
  }

  private attachmentRows(attachments: ImageSettings): FormRow[] {
    const { insertPolicy, customCopyDirectory } = attachments;
    const rows: FormRow[] = [
      {
        kind: 'choice',
        id: 'attachments.insertPolicy',
        label: i18next.t('settings.attachments.insertPolicy'),
        value: insertPolicy,
        options: policyOptions(POLICIES.map(({ value }) => value)),
      },
    ];
    if (insertPolicy === 'copy-custom-folder') {
      rows.push(
        {
          kind: 'value',
          id: 'attachments.customDirectory',
          label: i18next.t('settings.attachments.customDirectory'),
          value:
            customCopyDirectory ??
            i18next.t('settings.attachments.noCustomDirectory'),
        },
        {
          kind: 'button',
          id: 'attachments.chooseDirectory',
          label: i18next.t('settings.attachments.chooseDirectory'),
        }
      );
      if (customCopyDirectory) {
        rows.push({
          kind: 'button',
          id: 'attachments.clearDirectory',
          label: i18next.t('settings.attachments.clearDirectory'),
        });
      }
    }
    for (const { key, label } of ATTACHMENT_SWITCHES) {
      rows.push({
        kind: 'toggle',
        id: `attachments.${key}`,
        label: i18next.t(label),
        value: attachments[key],
      });
    }
    return rows;
  }

  private async handle(event: FormEvent) {
    if (event.op === 'dismiss') return this.close();
    const forAi =
      event.page !== 'settings' ||
      ('id' in event && event.id.startsWith('ai.'));
    if (forAi) {
      await this.aiTab?.handle(event);
      if (event.op === 'back') this.pop(event.page);
      return;
    }
    switch (event.op) {
      case 'tab':
        this.showTab(event.value);
        return;
      case 'change':
        this.change(event.id, event.value);
        return;
      case 'press':
        await this.press(event.id);
        return;
    }
  }

  private showTab(value: string) {
    if (!TABS.includes(value as NativeSettingsTab)) return;
    this.tab = value as NativeSettingsTab;
    if (this.tab === 'ai') this.loadAi();
  }

  private change(id: string, value: boolean | string | number) {
    if (id === 'general.language') {
      const general = { ...this.working.general, language: String(value) };
      this.working = { ...this.working, general };
      return;
    }
    if (id === 'appearance.theme') {
      this.setAppearance(
        { theme: value as AppearanceSettings['theme'] },
        'commit'
      );
      return;
    }
    const field = APPEARANCE_NUMBERS.find(
      ({ key }) => id === `appearance.${key}`
    );
    if (field) {
      const number = Number(value);
      if (number >= field.min && number <= field.max) {
        this.setAppearance({ [field.key]: number }, 'input');
      }
      return;
    }
    if (id === 'attachments.insertPolicy') {
      this.setAttachments({ insertPolicy: value as ImageInsertPolicy });
      return;
    }
    const toggle = ATTACHMENT_SWITCHES.find(
      ({ key }) => id === `attachments.${key}`
    );
    if (toggle) this.setAttachments({ [toggle.key]: Boolean(value) });
  }

  private async press(id: string) {
    switch (id) {
      case 'cancel':
        this.close();
        return;
      case 'ok':
        this.ok();
        return;
      case 'reset':
        await this.reset();
        return;
      case 'attachments.chooseDirectory': {
        const directory = await openDirectoryDialog();
        if (directory) this.setAttachments({ customCopyDirectory: directory });
        return;
      }
      case 'attachments.clearDirectory':
        this.setAttachments({ customCopyDirectory: null });
        return;
    }
  }

  /** A `commit` shows the appearance on the page at once, an `input` after a pause. */
  private setAppearance(
    patch: Partial<AppearanceSettings>,
    mode: 'input' | 'commit'
  ) {
    const appearance = sanitizeAppearanceSettings({
      ...this.working.appearance,
      ...patch,
    });
    this.working = { ...this.working, appearance };
    this.cancelPreview();
    if (mode === 'commit') {
      previewAppearance(appearance);
      return;
    }
    this.previewTimer = window.setTimeout(() => {
      this.previewTimer = null;
      previewAppearance(appearance);
    }, PREVIEW_DELAY_MS);
  }

  private cancelPreview() {
    if (this.previewTimer === null) return;
    window.clearTimeout(this.previewTimer);
    this.previewTimer = null;
  }

  private setAttachments(patch: Partial<ImageSettings>) {
    const attachments = { ...this.working.attachments, ...patch };
    this.working = { ...this.working, attachments };
  }

  private ok() {
    void updateSettings(changedSettings(this.opened, this.working)).catch(
      (error) => {
        void errorDialog(String(error));
      }
    );
    void this.settleSecrets(true).catch((error) => {
      void errorDialog(String(error));
    });
    this.close();
  }

  private async reset() {
    const reply = await this.form.alert({
      title: i18next.t('settings.confirmResetTitle'),
      message: i18next.t('settings.confirmResetBody'),
      actions: [
        { id: 'cancel', label: i18next.t('settings.cancel'), role: 'cancel' },
        {
          id: 'reset',
          label: i18next.t('settings.confirmResetButton'),
          role: 'destructive',
        },
      ],
    });
    if (reply !== 'reset') return;
    await resetSettings();
    this.close();
  }

  private close() {
    if (this.closing) return;
    this.closing = true;
    void this.settleSecrets(false).catch(console.error);
    this.aiTab?.destroy();
    i18next.off('languageChanged', this.refresh);
    this.cancelPreview();
    previewAppearance(getSettings().appearance);
    this.form.hide();
  }

  private push(id: string) {
    if (!this.stack.includes(id)) this.stack.push(id);
    this.refresh();
  }

  private pop(id: string) {
    const index = this.stack.indexOf(id);
    if (index >= 0) this.stack = this.stack.slice(0, index);
    this.refresh();
  }

  private async settleSecrets(keep: boolean) {
    if (!this.aiLoaded || this.secretsSettled) return;
    this.secretsSettled = true;
    await this.aiLoaded.catch(() => undefined);
    await this.aiTab?.settled();
    // Imported here so the keychain code stays out of start-up.
    const { commitAiSecrets, discardAiSecrets } = await import(
      '../../bridge/ipc/ai'
    );
    // A ChatGPT sign-out goes through the proxy that stays in force.
    if (!keep) {
      await discardAiSecrets(this.opened.ai.proxy);
      return;
    }
    await commitAiSecrets(this.working.ai.proxy);
    this.aiTab?.committed();
  }

  /** The AI tab loads with its first showing, to keep its services out of start-up. */
  private loadAi() {
    if (this.aiLoaded) return this.aiLoaded;
    this.aiLoaded = import('./settings-ai').then(({ createNativeAiTab }) => {
      if (this.closing) return;
      this.aiTab = createNativeAiTab(
        this.working.ai,
        (next) => {
          this.working = { ...this.working, ai: next };
          this.refresh();
        },
        {
          proxy: () => this.working.ai.proxy,
          form: this.form,
          push: (id) => this.push(id),
          pop: (id) => this.pop(id),
        }
      );
      this.refresh();
    });
    this.aiLoaded.catch((error) => {
      console.error('Failed to load the AI settings:', error);
    });
    return this.aiLoaded;
  }
}

let current: NativeSettings | null = null;

/** Opens the native settings at `tab`; `addService` as `SettingsPanel.open`. */
export function openNativeSettings(
  tab: NativeSettingsTab = 'general',
  options: { addService?: string } = {}
) {
  if (current?.form.isShown) return;
  current = new NativeSettings(tab, options.addService);
}

/** Has the native bottom bar's settings button open them. */
export function bindNativeSettings() {
  registerFormOpener('settings', () => openNativeSettings());
}
