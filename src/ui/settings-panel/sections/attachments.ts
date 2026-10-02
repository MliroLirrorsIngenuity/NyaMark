import type {
  ImageInsertPolicy,
  ImageSettings,
} from '../../../state/image-settings';
import { requireElement } from '../../require-element';

const POLICIES: Array<{
  value: ImageInsertPolicy;
  label: string;
  description: string;
}> = [
  {
    value: 'use-path',
    label: 'Keep original path',
    description: 'Reference the original file location, no copy.',
  },
  {
    value: 'copy-same-folder',
    label: 'Same folder',
    description: 'Copy next to the current document.',
  },
  {
    value: 'copy-assets',
    label: './assets',
    description: 'Copy into a sibling assets folder.',
  },
  {
    value: 'copy-custom-folder',
    label: 'Custom folder',
    description: 'Copy into the folder chosen below.',
  },
  {
    value: 'base64',
    label: 'Embed as Base64',
    description: 'Inline images directly inside the document.',
  },
];

export type AttachmentsSectionOptions = {
  /** Native folder picker; resolves to `null` when the user cancels. */
  pickDirectory: () => Promise<string | null>;
};

export function renderAttachmentsSection(
  current: ImageSettings,
  onChange: (next: ImageSettings) => void,
  options: AttachmentsSectionOptions
): HTMLElement {
  const section = document.createElement('section');
  section.className = 'ny-settings__section';
  section.innerHTML = `
    <h4 class="ny-settings__section-title" data-i18n="settings.attachments.title">Attachments</h4>
    <div class="ny-settings__row">
      <fieldset class="ny-settings__fieldset">
        <legend data-i18n="settings.attachments.insertPolicy">Insert policy for local images</legend>
        <div class="ny-settings__options" data-group="insertPolicy"></div>
      </fieldset>
    </div>
    <div class="ny-settings__row" data-row="customCopyDirectory">
      <div class="ny-settings__field">
        <span data-i18n="settings.attachments.customDirectory">Custom folder</span>
        <div class="ny-settings__directory">
          <span class="ny-settings__directory-path" data-key="customCopyDirectory"></span>
          <button type="button" class="ny-settings__directory-button" data-action="choose-directory" data-i18n="settings.attachments.chooseDirectory">Choose…</button>
          <button type="button" class="ny-settings__directory-button" data-action="clear-directory" data-i18n="settings.attachments.clearDirectory">Clear</button>
        </div>
      </div>
    </div>
    <div class="ny-settings__row">
      <label class="ny-settings__field ny-settings__field--checkbox">
        <input type="checkbox" data-key="preferRelativePath" />
        <span data-i18n="settings.attachments.preferRelativePath">Prefer relative paths</span>
      </label>
      <label class="ny-settings__field ny-settings__field--checkbox">
        <input type="checkbox" data-key="ensureDotSlash" />
        <span data-i18n="settings.attachments.ensureDotSlash">Prefix relative paths with <code>./</code></span>
      </label>
      <label class="ny-settings__field ny-settings__field--checkbox">
        <input type="checkbox" data-key="escapePath" />
        <span data-i18n="settings.attachments.escapePath">Encode spaces in paths as %20</span>
      </label>
    </div>
  `;

  // The folder is asked for only by the policy that copies into it.
  const directoryRow = requireElement(
    section,
    '[data-row="customCopyDirectory"]'
  );
  const showDirectoryRow = () => {
    directoryRow.hidden = current.insertPolicy !== 'copy-custom-folder';
  };
  showDirectoryRow();

  const policyGroup = section.querySelector<HTMLElement>(
    '[data-group="insertPolicy"]'
  );
  if (policyGroup) {
    for (const { value, label, description } of POLICIES) {
      const option = document.createElement('label');
      option.className = 'ny-settings__option';
      option.innerHTML = `
        <input type="radio" name="ny-settings-insert-policy" value="${value}" />
        <span><strong data-i18n="settings.attachments.policies.${value}.label">${label}</strong><span data-i18n="settings.attachments.policies.${value}.description">${description}</span></span>
      `;
      const input = requireElement<HTMLInputElement>(option, 'input');
      input.checked = current.insertPolicy === value;
      input.addEventListener('change', () => {
        if (!input.checked) return;
        const next = { ...current, insertPolicy: value };
        onChange(next);
        Object.assign(current, next);
        showDirectoryRow();
      });
      policyGroup.appendChild(option);
    }
  }

  const directoryPath = requireElement(
    section,
    '[data-key="customCopyDirectory"]'
  );
  const clearDirectory = requireElement<HTMLButtonElement>(
    section,
    '[data-action="clear-directory"]'
  );
  const showDirectory = () => {
    const directory = current.customCopyDirectory;
    if (directory) {
      directoryPath.removeAttribute('data-i18n');
      directoryPath.textContent = directory;
      directoryPath.title = directory;
    } else {
      directoryPath.setAttribute(
        'data-i18n',
        'settings.attachments.noCustomDirectory'
      );
      directoryPath.textContent = 'No custom folder selected';
      directoryPath.removeAttribute('title');
    }
    directoryPath.classList.toggle('is-empty', !directory);
    clearDirectory.hidden = !directory;
  };
  const setDirectory = (directory: string | null) => {
    const next = { ...current, customCopyDirectory: directory };
    onChange(next);
    Object.assign(current, next);
    showDirectory();
  };
  showDirectory();

  requireElement(section, '[data-action="choose-directory"]').addEventListener(
    'click',
    () => {
      void options.pickDirectory().then((directory) => {
        if (directory) setDirectory(directory);
      });
    }
  );
  clearDirectory.addEventListener('click', () => setDirectory(null));

  for (const input of section.querySelectorAll<HTMLInputElement>(
    'input[type="checkbox"][data-key]'
  )) {
    const key = input.dataset.key as keyof Pick<
      ImageSettings,
      'preferRelativePath' | 'ensureDotSlash' | 'escapePath'
    >;
    input.checked = Boolean(current[key]);
    input.addEventListener('change', () => {
      const next = { ...current, [key]: input.checked } as ImageSettings;
      onChange(next);
      Object.assign(current, next);
    });
  }

  return section;
}
