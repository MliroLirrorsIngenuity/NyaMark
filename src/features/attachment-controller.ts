import type { EditorAttachment } from '../editor/editor';
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
import { openMarkdownInNewWindow } from '../bridge/ipc/files';
import { listenWindowFileDrop } from '../bridge/ipc/windows';
import { openDirectoryDialog } from '../bridge/ipc/files';
import { getSettings, updateSettings, subscribeSettings } from '../state/settings';
import { ImagePolicyDialog } from '../ui/image-policy-dialog';
import {
  basename,
  defaultPastedImageName,
  extractClipboardFilePaths,
  getDocumentCopyTarget,
  isExternalResource,
  isImagePath,
  policyToInsertRule,
  type InsertRule,
} from './attachment-policy';

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
    editorContainer.addEventListener('paste', (event) => {
      const clipboard = event.clipboardData;
      if (!clipboard) return;

      const filePaths = extractClipboardFilePaths(clipboard);
      const files = Array.from(clipboard.files ?? []);
      if (!filePaths.length && !files.length) return;

      event.preventDefault();
      event.stopPropagation();
      void this.handleAttachmentPaste(files, filePaths);
    }, true);
  }

  async bindWindowFileDrop() {
    await listenWindowFileDrop((event) => {
      if (event.payload.type !== 'drop') return;
      void this.handleDroppedPaths(event.payload.paths);
    });
  }

  async upload(file: File) {
    const attachment = await this.materializeAttachment(file);
    return attachment?.href ?? '';
  }

  async resolvePreviewUrl(src: string) {
    if (!src || isExternalResource(src)) return src;

    const absolutePath = await resolveDocumentAssetPath(this.options.getDocumentPath(), src);
    return absolutePath ? toAssetUrl(absolutePath) : src;
  }

  async openLinkedResource(href: string) {
    const normalizedHref = href.trim();
    if (!normalizedHref) return;

    if (isExternalResource(normalizedHref)) {
      await openExternalUrl(normalizedHref);
      return;
    }

    const absolutePath = await resolveDocumentAssetPath(this.options.getDocumentPath(), normalizedHref);
    if (!absolutePath) return;

    if (/\.(md|markdown)$/i.test(absolutePath)) {
      await openMarkdownInNewWindow(absolutePath);
      return;
    }

    await openLocalPath(absolutePath);
  }

  private async handleDroppedPaths(paths: string[]) {
    const attachments: EditorAttachment[] = [];
    for (const path of paths) {
      const attachment = await this.createAttachmentFromLocalPath(path);
      if (attachment) {
        attachments.push(attachment);
      }
    }

    this.commitInsertedAttachments(attachments);
  }

  private async handleAttachmentPaste(files: File[], filePaths: string[]) {
    const attachments: EditorAttachment[] = [];
    const seenPaths = new Set<string>();

    for (const path of filePaths) {
      seenPaths.add(path);
      const attachment = await this.createAttachmentFromLocalPath(path);
      if (attachment) {
        attachments.push(attachment);
      }
    }

    for (const file of files) {
      const nativePath = this.getNativeFilePath(file);
      if (nativePath && seenPaths.has(nativePath)) {
        continue;
      }

      const attachment = await this.materializeAttachment(file);
      if (attachment) {
        attachments.push(attachment);
      }
    }

    this.commitInsertedAttachments(attachments);
  }

  private async materializeAttachment(file: File): Promise<EditorAttachment | null> {
    const nativePath = this.getNativeFilePath(file);
    if (nativePath) {
      return await this.createAttachmentFromLocalPath(nativePath);
    }

    if (!file.type.startsWith('image/')) {
      return null;
    }

    return await this.materializePastedImageAttachment(file);
  }

  private getNativeFilePath(file: File) {
    const candidate = (file as File & { path?: string }).path;
    return typeof candidate === 'string' && candidate.trim() ? candidate : null;
  }

  private async createAttachmentFromLocalPath(path: string): Promise<EditorAttachment | null> {
    const kind = isImagePath(path) ? 'image' : 'file';
    const label = basename(path);

    if (kind === 'image') {
      const insertRule = this.resolveExistingLocalImageRule();
      if (insertRule.mode === 'copy') {
        const filePath = this.options.getDocumentPath();
        if (!filePath) {
          const href = await formatMarkdownReference(null, path, this.getReferenceOptions());
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

  private async materializePastedImageAttachment(file: File): Promise<EditorAttachment | null> {
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
      const action = await this.imagePolicyDialog.chooseUnsavedPastedImageAction();
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

    const bytes = Array.from(new Uint8Array(await file.arrayBuffer()));
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

  private resolveExistingLocalImageRule(): InsertRule {
    const documentTarget = getDocumentCopyTarget(this.options.getMarkdown());
    if (documentTarget) {
      return { mode: 'copy', targetDir: documentTarget };
    }

    return policyToInsertRule(this.imageSettings.insertPolicy, this.imageSettings.customCopyDirectory);
  }

  private async resolvePastedImageRule(): Promise<InsertRule | null> {
    const documentTarget = getDocumentCopyTarget(this.options.getMarkdown());
    if (documentTarget) {
      return { mode: 'copy', targetDir: documentTarget };
    }

    if (this.imageSettings.pastedImagePolicy) {
      const storedRule = policyToInsertRule(
        this.imageSettings.pastedImagePolicy,
        this.imageSettings.customCopyDirectory
      );
      if (storedRule.mode !== 'use-path') {
        return storedRule;
      }
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
        customCopyDirectory: choice.customDirectory ?? this.imageSettings.customCopyDirectory,
      };
      this.imageSettings = next;
      void updateSettings({ attachments: next });
    }

    return policyToInsertRule(choice.policy, choice.customDirectory ?? this.imageSettings.customCopyDirectory);
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
    return await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result ?? ''));
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(file);
    });
  }
}
