import type { ImageSettings, ImageInsertPolicy } from '../../../state/image-settings';

const POLICIES: Array<{ value: ImageInsertPolicy; label: string; description: string }> = [
  { value: 'use-path', label: 'Keep original path', description: 'Reference the original file location, no copy.' },
  { value: 'copy-same-folder', label: 'Same folder', description: 'Copy next to the current document.' },
  { value: 'copy-assets', label: './assets', description: 'Copy into a sibling assets folder.' },
  {
    value: 'copy-custom-folder',
    label: 'Custom folder',
    description: 'Copy into a folder you choose. Set it from the paste dialog the first time.',
  },
  { value: 'base64', label: 'Embed as Base64', description: 'Inline images directly inside the document.' },
];

export function renderAttachmentsSection(
  current: ImageSettings,
  onChange: (next: ImageSettings) => void
): HTMLElement {
  const section = document.createElement('section');
  section.className = 'ny-settings__section';
  section.innerHTML = `
    <h4 class="ny-settings__section-title">Attachments</h4>
    <div class="ny-settings__row">
      <fieldset class="ny-settings__fieldset">
        <legend>Insert policy for local images</legend>
        <div class="ny-settings__options" data-group="insertPolicy"></div>
      </fieldset>
    </div>
    <div class="ny-settings__row">
      <label class="ny-settings__field ny-settings__field--checkbox">
        <input type="checkbox" data-key="preferRelativePath" />
        <span>Prefer relative paths</span>
      </label>
      <label class="ny-settings__field ny-settings__field--checkbox">
        <input type="checkbox" data-key="ensureDotSlash" />
        <span>Prefix relative paths with <code>./</code></span>
      </label>
      <label class="ny-settings__field ny-settings__field--checkbox">
        <input type="checkbox" data-key="escapePath" />
        <span>Escape spaces in paths</span>
      </label>
    </div>
  `;

  const policyGroup = section.querySelector<HTMLElement>('[data-group="insertPolicy"]');
  if (policyGroup) {
    POLICIES.forEach(({ value, label, description }) => {
      const option = document.createElement('label');
      option.className = 'ny-settings__option';
      option.innerHTML = `
        <input type="radio" name="ny-settings-insert-policy" value="${value}" />
        <span><strong>${label}</strong><span>${description}</span></span>
      `;
      const input = option.querySelector<HTMLInputElement>('input')!;
      input.checked = current.insertPolicy === value;
      input.addEventListener('change', () => {
        if (!input.checked) return;
        const next = { ...current, insertPolicy: value };
        onChange(next);
        Object.assign(current, next);
      });
      policyGroup.appendChild(option);
    });
  }

  section.querySelectorAll<HTMLInputElement>('input[type="checkbox"][data-key]').forEach((input) => {
    const key = input.dataset.key as keyof Pick<ImageSettings, 'preferRelativePath' | 'ensureDotSlash' | 'escapePath'>;
    input.checked = Boolean(current[key]);
    input.addEventListener('change', () => {
      const next = { ...current, [key]: input.checked } as ImageSettings;
      onChange(next);
      Object.assign(current, next);
    });
  });

  return section;
}
