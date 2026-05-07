// Pure types + defaults. Storage lives in `./settings.ts`; the attachment
// controller and policy dialog talk to that store directly.
export type ImageInsertPolicy =
  | 'use-path'
  | 'copy-same-folder'
  | 'copy-assets'
  | 'copy-custom-folder'
  | 'base64';

export type PastedImagePolicy = Exclude<ImageInsertPolicy, 'use-path'>;

export type ImageSettings = {
  insertPolicy: ImageInsertPolicy;
  pastedImagePolicy: PastedImagePolicy | null;
  preferRelativePath: boolean;
  ensureDotSlash: boolean;
  escapePath: boolean;
  customCopyDirectory: string | null;
};

export const defaultImageSettings: ImageSettings = {
  insertPolicy: 'use-path',
  pastedImagePolicy: null,
  preferRelativePath: true,
  ensureDotSlash: false,
  escapePath: false,
  customCopyDirectory: null,
};
