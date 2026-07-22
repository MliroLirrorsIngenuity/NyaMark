import { ensureStyle } from '../../style/register';

const css = `
.ny-editor-root .milkdown {
  --nyamark-accent: var(--ny-accent);
  --nyamark-accent-soft: var(--ny-accent-soft);
  --crepe-color-primary: var(--ny-accent);
  --crepe-color-inline-code: #3d6f84;
  --crepe-color-hover: #eef4f6;
  --crepe-color-selected: #e2edf1;
  --crepe-color-surface: #ffffff;
  --crepe-color-surface-low: #f7fafb;
  --crepe-color-surface-variant: #f1f5f9;
  --crepe-color-secondary: #d1d8e0;
  --crepe-color-on-surface: #334155;
  --crepe-color-on-surface-variant: #64748b;
  --crepe-color-on-secondary: #334155;
  --crepe-color-outline: rgba(186, 196, 210, 0.88);
  --crepe-font-default: var(--ny-font-sans);
  --crepe-font-code: var(--ny-font-mono);
  --ny-editor-text-primary: #17212b;
  --ny-editor-heading: #101828;
  --ny-editor-inline-code-bg: rgba(77, 122, 143, 0.09);
  --ny-editor-inline-code-border: #d6e6eb;
  --ny-editor-marker: #97a8b8;
  --ny-editor-check-mark: #ffffff;
  --ny-editor-quote-bar: rgba(148, 163, 178, 0.42);
  --ny-editor-rule: rgba(148, 163, 178, 0.3);
  --ny-editor-toolbar-bg: var(--ny-window-toolbar-bg, rgba(255, 255, 255, 0.82));
  --ny-editor-toolbar-shadow: 0 8px 24px rgba(15, 23, 42, 0.08), 0 2px 8px rgba(15, 23, 42, 0.04);
  --ny-editor-floating-bg: var(--ny-window-floating-bg, rgba(255, 255, 255, 0.96));
  --ny-editor-floating-shadow: 0 12px 30px rgba(15, 23, 42, 0.1);
  --ny-editor-codeblock-border: rgba(224, 230, 238, 0.92);
  --ny-editor-codeblock-bg: linear-gradient(180deg, rgba(255, 255, 255, 0.96) 0%, rgba(251, 252, 254, 0.98) 100%);
  --ny-editor-codeblock-shadow: 0 8px 24px rgba(148, 163, 184, 0.1), 0 2px 8px rgba(15, 23, 42, 0.04);
  --ny-editor-chip-bg: linear-gradient(180deg, #ffffff 0%, #f8f8f6 100%);
  --ny-editor-chip-border: rgba(223, 227, 235, 0.95);
  --ny-editor-chip-text: #5e6673;
  --ny-editor-chip-shadow: 0 1px 1px rgba(15, 23, 42, 0.03), inset 0 1px 0 rgba(255, 255, 255, 0.92);
  --ny-editor-button-bg: rgba(255, 255, 255, 0.82);
  --ny-editor-button-border: rgba(223, 227, 235, 0.9);
  --ny-editor-button-text: #69707c;
  --ny-editor-panel-bg: linear-gradient(180deg, #ffffff 0%, #fcfdff 100%);
  --ny-editor-panel-border: #e6ebf2;
  --ny-editor-gutter-bg: linear-gradient(180deg, #fbfcff 0%, #f6f8fc 100%);
  --ny-editor-gutter-text: #7b879c;
  --ny-editor-code-text: #2259a8;
  --ny-editor-active-line: rgba(72, 112, 255, 0.05);
  --ny-editor-preview-bg: linear-gradient(180deg, #fafdff 0%, #f5f9ff 100%);
  --ny-editor-preview-border: #e8eef8;
  --ny-editor-preview-text: #1f2937;
  color: var(--ny-editor-text-primary);
  font-family: var(--ny-font-sans);
  font-size: var(--ny-editor-font-size, 14px);
  line-height: var(--ny-editor-line-height, 1.52);
}

:root[data-theme="dark"] .ny-editor-root .milkdown {
  --crepe-color-inline-code: #c6dce8;
  --crepe-color-hover: rgba(141, 180, 200, 0.12);
  --crepe-color-selected: rgba(141, 180, 200, 0.18);
  --crepe-color-surface: #171d25;
  --crepe-color-surface-low: #131922;
  --crepe-color-secondary: #243040;
  --crepe-color-surface-variant: #1a212a;
  --crepe-color-on-surface: #c7d0db;
  --crepe-color-on-surface-variant: #91a0b2;
  --crepe-color-on-secondary: #c7d0db;
  --crepe-color-outline: rgba(101, 117, 139, 0.28);
  --ny-editor-text-primary: #e9f0f6;
  --ny-editor-heading: #f4f8fb;
  --ny-editor-inline-code-bg: rgba(141, 180, 200, 0.15);
  --ny-editor-inline-code-border: rgba(103, 123, 147, 0.34);
  --ny-editor-marker: #6b7d91;
  --ny-editor-check-mark: #101820;
  --ny-editor-quote-bar: rgba(140, 162, 184, 0.34);
  --ny-editor-rule: rgba(140, 162, 184, 0.24);
  --ny-editor-toolbar-bg: var(--ny-window-toolbar-bg, rgba(18, 24, 31, 0.74));
  --ny-editor-toolbar-shadow: 0 16px 36px rgba(0, 0, 0, 0.28);
  --ny-editor-floating-bg: var(--ny-window-floating-bg, rgba(22, 29, 38, 0.96));
  --ny-editor-floating-shadow: 0 18px 44px rgba(0, 0, 0, 0.32);
  --ny-editor-codeblock-border: rgba(96, 112, 132, 0.24);
  --ny-editor-codeblock-bg: linear-gradient(180deg, rgba(24, 31, 40, 0.96) 0%, rgba(20, 26, 35, 0.98) 100%);
  --ny-editor-codeblock-shadow: 0 10px 28px rgba(0, 0, 0, 0.2), inset 0 1px 0 rgba(255, 255, 255, 0.02);
  --ny-editor-chip-bg: linear-gradient(180deg, rgba(33, 42, 54, 0.98) 0%, rgba(26, 34, 44, 0.98) 100%);
  --ny-editor-chip-border: rgba(101, 117, 139, 0.26);
  --ny-editor-chip-text: #b0bcc9;
  --ny-editor-chip-shadow: 0 1px 0 rgba(255, 255, 255, 0.02), inset 0 1px 0 rgba(255, 255, 255, 0.02);
  --ny-editor-button-bg: rgba(28, 36, 46, 0.84);
  --ny-editor-button-border: rgba(96, 112, 132, 0.28);
  --ny-editor-button-text: #c8d2dd;
  --ny-editor-panel-bg: linear-gradient(180deg, #1a212a 0%, #161c24 100%);
  --ny-editor-panel-border: rgba(96, 112, 132, 0.24);
  --ny-editor-gutter-bg: linear-gradient(180deg, rgba(31, 39, 50, 0.98) 0%, rgba(23, 30, 40, 0.98) 100%);
  --ny-editor-gutter-text: #748297;
  --ny-editor-code-text: #a8c8f7;
  --ny-editor-active-line: rgba(98, 137, 255, 0.12);
  --ny-editor-preview-bg: linear-gradient(180deg, #151c24 0%, #11171f 100%);
  --ny-editor-preview-border: rgba(89, 105, 126, 0.28);
  --ny-editor-preview-text: #e9f0f6;
}
`;

export function registerSharedStyles() {
  ensureStyle('editor-shared-vars', css);
}
