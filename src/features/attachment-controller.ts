import type { EditorAttachment } from '../editor/editor';
import type {
  ImageInsertPolicy,
  PastedImagePolicy,
} from '../state/image-settings';
import {
  type AttachmentReferenceOptions,
  copyLocalAttachment,
  formatMarkdownReference,
  resolveDocumentAssetPath,
  storeAttachmentInDirectory,
  toAssetUrl,
  openLocalPath,
  openExternalUrl,
} from '../bridge/ipc/attachments';
import {
  errorDialog,
  openDirectoryDialog,
  openImageFileDialog,
  openMarkdownInNewWindow,
} from '../bridge/ipc/files';
import { listenWindowFileDrop } from '../bridge/ipc/windows';
import { i18next } from '../i18n';
import {
  getSettings,
  updateSettings,
  subscribeSettings,
} from '../state/settings';
import { ImagePolicyDialog } from '../ui/image-policy-dialog';
import { looksLikeExternalResource } from './attachment-paths';
import {
  basename,
  classifyLinkTarget,
  defaultPastedImageName,
  extractClipboardFilePaths,
  getDocumentCopyTarget,
  IMAGE_EXTENSIONS,
  isImagePath,
  policyToInsertRule,
  type InsertRule,
} from './attachment-policy';

/**
 * Largest image embedded as Base64. The text grows by a third, and a document
 * over the 20 MiB open limit could never be reopened.
 */
const MAX_BASE64_IMAGE_BYTES = 5 * 1024 * 1024;

/** One file to insert: a name for the error message and how to load it. */
type AttachmentSource = {
  name: string;
  load: () => Promise<EditorAttachment | null>;
};

type AttachmentControllerOptions = {
  getMarkdown: () => string;
  getDocumentPath: () => string | null;
  saveDocumentAs: () => Promise<string | null>;
  insertAttachments: (attachments: EditorAttachment[]) => void;
  onAttachmentsInserted: () => void;
};

export class AttachmentController {
  private readonly options: AttachmentControllerOptions;
  private readonly imagePolicyDialog = new ImagePolicyDialog();
  private imageSettings = getSettings().attachments;
  private unsubscribeSettings: (() => void) | null = null;

  constructor(options: AttachmentControllerOptions) {
    this.options = options;
    this.unsubscribeSettings = subscribeSettings((settings) => {
      this.imageSettings = settings.attachments;
    });
  }

  dispose() {
    this.unsubscribeSettings?.();
    this.unsubscribeSettings = null;
  }

  bindPaste(editorContainer: HTMLElement) {
    editorContainer.addEventListener(
      'paste',
      (event) => {
        const clipboard = event.clipboardData;
        if (!clipboard) return;

        const filePaths = extractClipboardFilePaths(clipboard);
        const files = Array.from(clipboard.files ?? []);
        if (!filePaths.length && !files.length) return;

        event.preventDefault();
        event.stopPropagation();
        void this.handleAttachmentPaste(files, filePaths);
      },
      true
    );
  }

  /**
   * The image block's upload button opens a plain `<input type="file">`, whose
   * File carries no path, so the insert policy (keep the path, copy next to
   * the document...) could not apply. Picking through the native dialog
   * yields a path; the result goes back through the block's own link field.
   */
  bindImagePicker(editorContainer: HTMLElement) {
    editorContainer.addEventListener(
      'click',
      (event) => {
        const target = event.target instanceof Element ? event.target : null;
        const uploader = target?.closest('.image-edit .uploader');
        const linkInput = uploader
          ?.closest('.image-edit')
          ?.querySelector<HTMLInputElement>('.link-input-area');
        if (!linkInput || linkInput.disabled) return;
        event.preventDefault();
        event.stopPropagation();
        void this.pickImageInto(linkInput);
      },
      true
    );
  }

  private async pickImageInto(linkInput: HTMLInputElement) {
    const path = await openImageFileDialog(
      i18next.t('dialog.imageFilter'),
      IMAGE_EXTENSIONS
    );
    if (!path) return;
    try {
      const attachment = await this.createAttachmentFromLocalPath(path);
      if (!attachment) return;
      linkInput.value = attachment.href;
      linkInput.dispatchEvent(new Event('input', { bubbles: true }));
      linkInput.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })
      );
    } catch (error) {
      console.error('Failed to insert picked image:', error);
      await this.reportFailure('insert', basename(path), error);
    }
  }

  async bindWindowFileDrop() {
    await listenWindowFileDrop((event) => {
      if (event.payload.type !== 'drop') return;
      void this.handleDroppedPaths(event.payload.paths);
    });
  }

  /**
   * Upload hook of the image block, for files that reach it without going
   * through `bindImagePicker`. Without a path they are handled like pasted
   * images. Crepe only logs a rejected upload, so the failure is reported
   * here; an empty URL keeps its placeholder open.
   */
  async upload(file: File) {
    try {
      const attachment = await this.materializeAttachment(file);
      return attachment?.href ?? '';
    } catch (error) {
      console.error('Failed to upload attachment:', error);
      await this.reportFailure('insert', this.describeFile(file), error);
      return '';
    }
  }

  async resolvePreviewUrl(src: string) {
    if (!src || looksLikeExternalResource(src)) return src;

    const absolutePath = await resolveDocumentAssetPath(
      this.options.getDocumentPath(),
      src
    );
    return absolutePath ? toAssetUrl(absolutePath) : src;
  }

  async openLinkedResource(href: string) {
    try {
      await this.openLinkTarget(href);
    } catch (error) {
      console.error('Failed to open linked resource:', error);
      await this.reportFailure('open', href, error);
    }
  }

  private async openLinkTarget(href: string) {
    const target = classifyLinkTarget(href);
    if (target.kind === 'ignore') {
      console.warn('Ignoring link with unsupported scheme:', href);
      return;
    }

    if (target.kind === 'url') {
      await openExternalUrl(target.url);
      return;
    }

    const absolutePath = await resolveDocumentAssetPath(
      this.options.getDocumentPath(),
      target.reference
    );
    if (!absolutePath) return;

    if (/\.(md|markdown)$/i.test(absolutePath)) {
      await openMarkdownInNewWindow(absolutePath);
      return;
    }

    await openLocalPath(absolutePath);
  }

  private handleDroppedPaths(paths: string[]) {
    return this.insertFromSources(
      paths.map((path) => ({
        name: basename(path),
        load: () => this.createAttachmentFromLocalPath(path),
      }))
    );
  }

  private handleAttachmentPaste(files: File[], filePaths: string[]) {
    const sources: AttachmentSource[] = [];
    // A file copied in the file manager arrives twice: as a path and as File
    // contents. The webview's File has no path, so the name is the link.
    const pathNames = new Set<string>();

    for (const path of filePaths) {
      pathNames.add(basename(path));
      sources.push({
        name: basename(path),
        load: () => this.createAttachmentFromLocalPath(path),
      });
    }

    for (const file of files) {
      if (file.name && pathNames.has(file.name)) {
        continue;
      }
      sources.push({
        name: this.describeFile(file),
        load: () => this.materializeAttachment(file),
      });
    }

    return this.insertFromSources(sources);
  }

  /**
   * Load the sources one after another, insert whatever succeeded and show
   * the first failure. One unreadable file must neither hold back the others
   * nor vanish into the console: a paste that silently does nothing looks
   * like a broken editor.
   */
  private async insertFromSources(sources: AttachmentSource[]) {
    const attachments: EditorAttachment[] = [];
    let failure: { name: string; error: unknown } | null = null;

    for (const source of sources) {
      try {
        const attachment = await source.load();
        if (attachment) attachments.push(attachment);
      } catch (error) {
        console.error(`Failed to insert attachment "${source.name}":`, error);
        failure ??= { name: source.name, error };
      }
    }

    this.commitInsertedAttachments(attachments);
    if (failure) {
      await this.reportFailure('insert', failure.name, failure.error);
    }
  }

  private async reportFailure(
    action: 'insert' | 'open',
    name: string,
    error: unknown
  ) {
    const reason = error instanceof Error ? error.message : String(error);
    await errorDialog(
      i18next.t(
        action === 'insert'
          ? 'dialog.attachmentError.insertFailed'
          : 'dialog.attachmentError.openFailed',
        { name, reason }
      )
    );
  }

  private describeFile(file: File) {
    return file.name || defaultPastedImageName(file);
  }

  private async materializeAttachment(
    file: File
  ): Promise<EditorAttachment | null> {
    if (!file.type.startsWith('image/')) {
      return null;
    }

    return await this.materializePastedImageAttachment(file);
  }

  private async createAttachmentFromLocalPath(
    path: string
  ): Promise<EditorAttachment | null> {
    const kind = isImagePath(path) ? 'image' : 'file';
    const label = basename(path);

    if (kind === 'image') {
      const insertRule = await this.resolveExistingLocalImageRule();
      if (!insertRule) return null;
      if (insertRule.mode === 'copy') {
        const filePath = this.options.getDocumentPath();
        if (!filePath) {
          const href = await formatMarkdownReference(
            null,
            path,
            this.getReferenceOptions()
          );
          return { kind, href, label };
        }

        const stored = await copyLocalAttachment(
          filePath,
          path,
          insertRule.targetDir,
          this.getReferenceOptions()
        );
        return { kind, href: stored.markdownPath, label };
      }
    }

    const href = await formatMarkdownReference(
      this.options.getDocumentPath(),
      path,
      this.getReferenceOptions()
    );
    return { kind, href, label };
  }

  private async materializePastedImageAttachment(
    file: File
  ): Promise<EditorAttachment | null> {
    const insertRule = await this.resolvePastedImageRule();
    if (!insertRule) return null;

    if (insertRule.mode === 'base64') {
      return {
        kind: 'image',
        href: await this.readFileAsDataUrl(file),
        label: file.name || defaultPastedImageName(file),
      };
    }

    if (insertRule.mode !== 'copy') {
      return null;
    }

    let filePath = this.options.getDocumentPath();
    if (!filePath) {
      const action =
        await this.imagePolicyDialog.chooseUnsavedPastedImageAction();
      if (action === 'cancel') return null;
      if (action === 'base64') {
        return {
          kind: 'image',
          href: await this.readFileAsDataUrl(file),
          label: file.name || defaultPastedImageName(file),
        };
      }

      filePath = await this.options.saveDocumentAs();
      if (!filePath) return null;
    }

    const bytes = new Uint8Array(await file.arrayBuffer());
    const stored = await storeAttachmentInDirectory(
      filePath,
      insertRule.targetDir,
      file.name || defaultPastedImageName(file),
      bytes,
      this.getReferenceOptions()
    );

    return {
      kind: 'image',
      href: stored.markdownPath,
      label: file.name || basename(stored.markdownPath),
    };
  }

  private async resolveExistingLocalImageRule(): Promise<InsertRule | null> {
    const documentTarget = getDocumentCopyTarget(this.options.getMarkdown());
    if (documentTarget) {
      return { mode: 'copy', targetDir: documentTarget };
    }

    return await this.ruleForPolicy(
      this.imageSettings.insertPolicy,
      this.imageSettings.customCopyDirectory
    );
  }

  /**
   * The rule for a policy, asking for the custom folder when the policy
   * needs one that was never chosen. A cancelled folder dialog cancels the
   * insertion (`null`).
   */
  private async ruleForPolicy(
    policy: ImageInsertPolicy | PastedImagePolicy,
    customDirectory: string | null
  ): Promise<InsertRule | null> {
    const rule = policyToInsertRule(policy, customDirectory);
    if (rule) return rule;
    const directory = await this.requestCustomDirectory();
    return directory ? { mode: 'copy', targetDir: directory } : null;
  }

  private async requestCustomDirectory(): Promise<string | null> {
    const directory = await openDirectoryDialog();
    if (!directory) return null;
    const next = { ...this.imageSettings, customCopyDirectory: directory };
    this.imageSettings = next;
    updateSettings({ attachments: next }).catch((error) => {
      console.error('Failed to save attachment settings:', error);
    });
    return directory;
  }

  private async resolvePastedImageRule(): Promise<InsertRule | null> {
    const documentTarget = getDocumentCopyTarget(this.options.getMarkdown());
    if (documentTarget) {
      return { mode: 'copy', targetDir: documentTarget };
    }

    if (this.imageSettings.pastedImagePolicy) {
      return await this.ruleForPolicy(
        this.imageSettings.pastedImagePolicy,
        this.imageSettings.customCopyDirectory
      );
    }

    const choice = await this.imagePolicyDialog.choosePastedImagePolicy({
      customDirectory: this.imageSettings.customCopyDirectory,
      pickCustomDirectory: () => openDirectoryDialog(),
    });
    if (!choice) return null;

    if (choice.remember) {
      const next = {
        ...this.imageSettings,
        pastedImagePolicy: choice.policy,
        customCopyDirectory:
          choice.customDirectory ?? this.imageSettings.customCopyDirectory,
      };
      this.imageSettings = next;
      updateSettings({ attachments: next }).catch((error) => {
        console.error('Failed to save attachment settings:', error);
      });
    }

    return await this.ruleForPolicy(
      choice.policy,
      choice.customDirectory ?? this.imageSettings.customCopyDirectory
    );
  }

  private commitInsertedAttachments(attachments: EditorAttachment[]) {
    if (attachments.length === 0) return;
    this.options.insertAttachments(attachments);
    this.options.onAttachmentsInserted();
  }

  private getReferenceOptions(): AttachmentReferenceOptions {
    return {
      preferRelativePath: this.imageSettings.preferRelativePath,
      ensureDotSlash: this.imageSettings.ensureDotSlash,
      escapePath: this.imageSettings.escapePath,
    };
  }

  private async readFileAsDataUrl(file: File) {
    if (file.size > MAX_BASE64_IMAGE_BYTES) {
      throw new Error(
        i18next.t('dialog.attachmentError.base64TooLarge', {
          size: (file.size / 1024 / 1024).toFixed(1),
          limit: MAX_BASE64_IMAGE_BYTES / 1024 / 1024,
        })
      );
    }
    return await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result ?? ''));
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(file);
    });
  }
}
