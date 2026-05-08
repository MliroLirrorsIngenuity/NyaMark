import { Crepe, CrepeFeature } from '@milkdown/crepe';
import { languages as codeLanguages } from '@codemirror/language-data';
import { renderMermaidPreview } from './plugins/mermaid';

export type CrepeConfigOptions = {
  root: HTMLElement;
  defaultValue: string;
  onUpload: (file: File) => Promise<string>;
  proxyDomURL: (src: string) => Promise<string> | string;
};

/**
 * Single source of truth for the Crepe builder config used by NyaEditor.
 * Anything that wants to tweak features goes here, not in `editor.ts`.
 *
 * `languages` from @codemirror/language-data wires up the dynamic loader so
 * Crepe's CodeBlock feature can ask CodeMirror to highlight whatever fenced
 * language the user typed (lazy-loaded). Without this list Crepe falls back
 * to plain text rendering with no token colours at all.
 */
export function buildCrepeConfig(
  opts: CrepeConfigOptions
): ConstructorParameters<typeof Crepe>[0] {
  return {
    root: opts.root,
    defaultValue: opts.defaultValue,
    features: {
      [CrepeFeature.Placeholder]: false,
      [CrepeFeature.TopBar]: true,
    },
    featureConfigs: {
      [CrepeFeature.BlockEdit]: {
        blockHandle: { getOffset: () => 8 },
      },
      [CrepeFeature.CodeMirror]: {
        languages: codeLanguages,
        renderPreview: renderMermaidPreview,
      },
      [CrepeFeature.ImageBlock]: {
        onUpload: opts.onUpload,
        proxyDomURL: opts.proxyDomURL,
      },
    },
  };
}
