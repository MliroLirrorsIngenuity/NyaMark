import { ensureStyle } from '../style/register';
import { translateDOM } from '../i18n/dom';

export type PastedImagePolicyChoice = {
  policy: 'copy-same-folder' | 'copy-assets' | 'copy-custom-folder' | 'base64';
  customDirectory: string | null;
  remember: boolean;
};

const imagePolicyDialogStyles = `
.ny-image-policy-overlay {
  position: fixed;
  inset: 0;
  z-index: 120;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  background: color-mix(in srgb, var(--ny-bg-primary), transparent 26%);
  backdrop-filter: blur(10px) saturate(1.08);
  -webkit-backdrop-filter: blur(10px) saturate(1.08);
}

.ny-image-policy-overlay[hidden] {
  display: none;
}

.ny-image-policy-dialog {
  width: min(480px, calc(100vw - 40px));
  padding: 22px 22px 18px;
  border: 1px solid var(--ny-border-strong);
  border-radius: 24px;
  background: var(--ny-surface-ghost);
  box-shadow: var(--ny-shadow-float);
  color: var(--ny-text-primary);
  user-select: none;
  -webkit-user-select: none;
}

.ny-image-policy-dialog h3 {
  margin: 0 0 8px;
  font-size: 18px;
  font-weight: 700;
}

.ny-image-policy-dialog p {
  margin: 0;
  color: var(--ny-text-secondary);
  font-size: 13px;
  line-height: 1.5;
}

.ny-image-policy-dialog__section {
  margin-top: 18px;
}

.ny-image-policy-dialog__options {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.ny-image-policy-dialog__option {
  display: flex;
  gap: 12px;
  align-items: flex-start;
  padding: 12px 14px;
  border: 1px solid color-mix(in srgb, var(--ny-border-strong), transparent 16%);
  border-radius: 16px;
  background: color-mix(in srgb, var(--ny-surface-elevated), transparent 22%);
}

.ny-image-policy-dialog__option input {
  margin-top: 3px;
}

.ny-image-policy-dialog__option strong {
  display: block;
  margin-bottom: 3px;
  font-size: 14px;
  font-weight: 650;
  color: var(--ny-text-primary);
}

.ny-image-policy-dialog__option span {
  display: block;
  color: var(--ny-text-secondary);
  font-size: 12.5px;
  line-height: 1.45;
}

.ny-image-policy-dialog__custom {
  display: flex;
  gap: 10px;
  align-items: center;
  margin-top: 12px;
}

.ny-image-policy-dialog__custom-path {
  flex: 1;
  min-height: 18px;
  padding: 10px 12px;
  border: 1px solid color-mix(in srgb, var(--ny-border-strong), transparent 16%);
  border-radius: 12px;
  background: color-mix(in srgb, var(--ny-surface-elevated), transparent 32%);
  color: var(--ny-text-secondary);
  font-size: 12.5px;
  line-height: 1.45;
  word-break: break-all;
}

.ny-image-policy-dialog__checkbox {
  display: inline-flex;
  gap: 8px;
  align-items: center;
  margin-top: 14px;
  color: var(--ny-text-secondary);
  font-size: 12.5px;
}

.ny-image-policy-dialog__actions {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  margin-top: 18px;
}

.ny-image-policy-dialog__button {
  min-width: 92px;
  padding: 10px 16px;
  border: 1px solid color-mix(in srgb, var(--ny-border-strong), transparent 8%);
  border-radius: 999px;
  background: color-mix(in srgb, var(--ny-surface-elevated), transparent 12%);
  color: var(--ny-text-primary);
  font: inherit;
  cursor: default;
}

.ny-image-policy-dialog__button--primary {
  background: color-mix(in srgb, var(--ny-accent), var(--ny-surface-elevated) 14%);
}

.ny-image-policy-dialog__button:hover {
  border-color: color-mix(in srgb, var(--ny-accent), transparent 36%);
}
`;

export class ImagePolicyDialog {
  private readonly overlay: HTMLDivElement;

  constructor() {
    ensureStyle('image-policy-dialog', imagePolicyDialogStyles);
    this.overlay = document.createElement('div');
    this.overlay.className = 'ny-image-policy-overlay';
    this.overlay.hidden = true;
    document.body.appendChild(this.overlay);
  }

  async choosePastedImagePolicy(options: {
    customDirectory: string | null;
    pickCustomDirectory: () => Promise<string | null>;
  }): Promise<PastedImagePolicyChoice | null> {
    return await new Promise((resolve) => {
      this.overlay.innerHTML = '';
      this.overlay.hidden = false;

      const panel = document.createElement('div');
      panel.className = 'ny-image-policy-dialog';
      panel.innerHTML = `
        <h3 data-i18n="dialog.imagePolicy.title">Pasted images need a save location</h3>
        <p data-i18n="dialog.imagePolicy.subtitle">Pick a rule once. Later screenshot paste will follow it silently.</p>
        <div class="ny-image-policy-dialog__section ny-image-policy-dialog__options">
          ${this.optionMarkup('copy-same-folder', 'settings.attachments.policies.copy-same-folder.label', 'Same folder as current Markdown file', 'settings.attachments.policies.copy-same-folder.description', 'Save pasted images next to the current document.')}
          ${this.optionMarkup('copy-assets', 'settings.attachments.policies.copy-assets.label', './assets', 'settings.attachments.policies.copy-assets.description', 'Store pasted images in an assets folder beside the current document.')}
          ${this.optionMarkup('copy-custom-folder', 'settings.attachments.policies.copy-custom-folder.label', 'Custom folder…', 'settings.attachments.policies.copy-custom-folder.description', 'Use one folder you choose and keep using it later.')}
          ${this.optionMarkup('base64', 'settings.attachments.policies.base64.label', 'Embed as Base64', 'settings.attachments.policies.base64.description', 'Keep the image inside the Markdown file itself.')}
        </div>
      `;

      const customRow = document.createElement('div');
      customRow.className = 'ny-image-policy-dialog__custom';

      const customPath = document.createElement('div');
      customPath.className = 'ny-image-policy-dialog__custom-path';
      customPath.textContent =
        options.customDirectory || 'No custom folder selected';
      if (!options.customDirectory)
        customPath.setAttribute('data-i18n', 'dialog.imagePolicy.noFolder');

      const pickButton = document.createElement('button');
      pickButton.type = 'button';
      pickButton.className = 'ny-image-policy-dialog__button';
      pickButton.textContent = 'Choose…';
      pickButton.setAttribute('data-i18n', 'dialog.imagePolicy.choose');

      customRow.append(customPath, pickButton);
      panel.appendChild(customRow);

      const remember = document.createElement('label');
      remember.className = 'ny-image-policy-dialog__checkbox';
      remember.innerHTML =
        '<input type="checkbox" checked /> <span data-i18n="dialog.imagePolicy.remember">Remember this choice</span>';
      panel.appendChild(remember);

      const actions = document.createElement('div');
      actions.className = 'ny-image-policy-dialog__actions';

      const cancel = document.createElement('button');
      cancel.type = 'button';
      cancel.className = 'ny-image-policy-dialog__button';
      cancel.textContent = 'Cancel';
      cancel.setAttribute('data-i18n', 'settings.cancel');

      const confirm = document.createElement('button');
      confirm.type = 'button';
      confirm.className =
        'ny-image-policy-dialog__button ny-image-policy-dialog__button--primary';
      confirm.textContent = 'Save';
      confirm.setAttribute('data-i18n', 'settings.ok');

      actions.append(cancel, confirm);
      panel.appendChild(actions);
      this.overlay.appendChild(panel);
      translateDOM(this.overlay);

      const policyInputs = Array.from(
        panel.querySelectorAll<HTMLInputElement>(
          'input[name="ny-image-policy"]'
        )
      );
      const rememberInput = remember.querySelector('input') as HTMLInputElement;
      const setSelected = (value: PastedImagePolicyChoice['policy']) => {
        policyInputs.forEach((input) => {
          input.checked = input.value === value;
        });
      };
      setSelected('copy-assets');

      let customDirectory = options.customDirectory;

      const close = (value: PastedImagePolicyChoice | null) => {
        this.overlay.hidden = true;
        this.overlay.innerHTML = '';
        resolve(value);
      };

      cancel.addEventListener('click', () => close(null));
      this.overlay.addEventListener(
        'click',
        (event) => {
          if (event.target === this.overlay) {
            close(null);
          }
        },
        { once: true }
      );

      pickButton.addEventListener('click', async () => {
        const path = await options.pickCustomDirectory();
        if (!path) return;
        customDirectory = path;
        customPath.textContent = path;
        setSelected('copy-custom-folder');
      });

      confirm.addEventListener('click', () => {
        const selected = policyInputs.find((input) => input.checked)?.value as
          | PastedImagePolicyChoice['policy']
          | undefined;
        if (!selected) {
          close(null);
          return;
        }

        if (selected === 'copy-custom-folder' && !customDirectory) {
          pickButton.click();
          return;
        }

        close({
          policy: selected,
          customDirectory:
            selected === 'copy-custom-folder' ? customDirectory : null,
          remember: rememberInput.checked,
        });
      });
    });
  }

  async chooseUnsavedPastedImageAction(): Promise<
    'save-document' | 'base64' | 'cancel'
  > {
    return await new Promise((resolve) => {
      this.overlay.innerHTML = '';
      this.overlay.hidden = false;

      const panel = document.createElement('div');
      panel.className = 'ny-image-policy-dialog';
      panel.innerHTML = `
        <h3>Save this document before inserting pasted images</h3>
        <p>Screenshot images have no original file path. Save the document first, or embed this image as Base64.</p>
      `;

      const actions = document.createElement('div');
      actions.className = 'ny-image-policy-dialog__actions';

      const cancel = document.createElement('button');
      cancel.type = 'button';
      cancel.className = 'ny-image-policy-dialog__button';
      cancel.textContent = 'Cancel';

      const base64 = document.createElement('button');
      base64.type = 'button';
      base64.className = 'ny-image-policy-dialog__button';
      base64.textContent = 'Embed as Base64';

      const saveDocument = document.createElement('button');
      saveDocument.type = 'button';
      saveDocument.className =
        'ny-image-policy-dialog__button ny-image-policy-dialog__button--primary';
      saveDocument.textContent = 'Save Document';

      actions.append(cancel, base64, saveDocument);
      panel.appendChild(actions);
      this.overlay.appendChild(panel);

      const close = (value: 'save-document' | 'base64' | 'cancel') => {
        this.overlay.hidden = true;
        this.overlay.innerHTML = '';
        resolve(value);
      };

      cancel.addEventListener('click', () => close('cancel'));
      base64.addEventListener('click', () => close('base64'));
      saveDocument.addEventListener('click', () => close('save-document'));
      this.overlay.addEventListener(
        'click',
        (event) => {
          if (event.target === this.overlay) {
            close('cancel');
          }
        },
        { once: true }
      );
    });
  }

  private optionMarkup(
    value: PastedImagePolicyChoice['policy'],
    titleKey: string,
    titleFallback: string,
    descKey: string,
    descFallback: string
  ) {
    return `
      <label class="ny-image-policy-dialog__option">
        <input type="radio" name="ny-image-policy" value="${value}" />
        <span>
          <strong data-i18n="${titleKey}">${titleFallback}</strong>
          <span data-i18n="${descKey}">${descFallback}</span>
        </span>
      </label>
    `;
  }
}
