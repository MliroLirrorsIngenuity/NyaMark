import { i18next } from '../../i18n';
import type {
  ImagePolicyDialog,
  PastedImagePolicyChoice,
} from '../../ui/image-policy-dialog';
import {
  type FormEvent,
  type FormPage,
  type FormView,
  NativeForm,
} from './form';
import { policyOptions } from './settings';

type PastedPolicy = PastedImagePolicyChoice['policy'];
type PolicyOptions = Parameters<
  ImagePolicyDialog['choosePastedImagePolicy']
>[0];
type UnsavedAction = Awaited<
  ReturnType<ImagePolicyDialog['chooseUnsavedPastedImageAction']>
>;

const PASTED_POLICIES: readonly PastedPolicy[] = [
  'copy-same-folder',
  'copy-assets',
  'copy-custom-folder',
  'base64',
];

const single = (page: FormPage, height: FormView['height']): FormView => ({
  pages: [page],
  height,
  dismissible: true,
});

/** The two image questions in the native form, as `ImagePolicyDialog` is on the page. */
export class NativeImagePolicyDialog
  implements
    Pick<
      ImagePolicyDialog,
      'choosePastedImagePolicy' | 'chooseUnsavedPastedImageAction'
    >
{
  choosePastedImagePolicy(
    options: PolicyOptions
  ): Promise<PastedImagePolicyChoice | null> {
    return new Promise((resolve) => {
      let policy: PastedPolicy = 'copy-assets';
      let customDirectory = options.customDirectory;
      let remember = true;

      const view = () =>
        single(
          {
            id: 'image-policy',
            title: i18next.t('dialog.imagePolicy.title'),
            leading: { id: 'cancel', label: i18next.t('settings.cancel') },
            trailing: {
              id: 'ok',
              label: i18next.t('settings.ok'),
              role: 'primary',
            },
            sections: [
              {
                id: 'subtitle',
                rows: [
                  {
                    kind: 'note',
                    id: 'subtitle',
                    text: i18next.t('dialog.imagePolicy.subtitle'),
                  },
                ],
              },
              {
                id: 'policy',
                rows: [
                  {
                    kind: 'cards',
                    id: 'policy',
                    value: policy,
                    options: policyOptions(PASTED_POLICIES),
                  },
                ],
              },
              {
                id: 'folder',
                rows: [
                  {
                    kind: 'button',
                    id: 'choose',
                    label: i18next.t('dialog.imagePolicy.choose'),
                    detail:
                      customDirectory ??
                      i18next.t('dialog.imagePolicy.noFolder'),
                  },
                ],
              },
              {
                id: 'remember',
                rows: [
                  {
                    kind: 'toggle',
                    id: 'remember',
                    label: i18next.t('dialog.imagePolicy.remember'),
                    value: remember,
                  },
                ],
              },
            ],
          },
          'large'
        );

      const pickDirectory = async () => {
        const path = await options.pickCustomDirectory();
        if (!path) return;
        customDirectory = path;
        policy = 'copy-custom-folder';
      };

      const confirm = async () => {
        if (policy === 'copy-custom-folder' && !customDirectory) {
          await pickDirectory();
          return;
        }
        finish({
          policy,
          customDirectory:
            policy === 'copy-custom-folder' ? customDirectory : null,
          remember,
        });
      };

      const finish = (value: PastedImagePolicyChoice | null) => {
        form.hide();
        resolve(value);
      };

      const handle = async (event: FormEvent) => {
        if (event.op === 'dismiss') finish(null);
        if (event.op === 'change') {
          if (event.id === 'policy') policy = event.value as PastedPolicy;
          if (event.id === 'remember') remember = Boolean(event.value);
        }
        if (event.op !== 'press') return;
        if (event.id === 'cancel') finish(null);
        if (event.id === 'choose') await pickDirectory();
        if (event.id === 'ok') await confirm();
      };

      const form = new NativeForm('image-policy', view, handle);
      form.show();
    });
  }

  chooseUnsavedPastedImageAction(): Promise<UnsavedAction> {
    return new Promise((resolve) => {
      const finish = (action: UnsavedAction) => {
        form.hide();
        resolve(action);
      };

      const view = () =>
        single(
          {
            id: 'image-unsaved',
            title: i18next.t('dialog.unsavedImage.title'),
            leading: { id: 'cancel', label: i18next.t('settings.cancel') },
            trailing: {
              id: 'save-document',
              label: i18next.t('dialog.unsavedImage.saveDocument'),
              role: 'primary',
            },
            sections: [
              {
                id: 'subtitle',
                rows: [
                  {
                    kind: 'note',
                    id: 'subtitle',
                    text: i18next.t('dialog.unsavedImage.subtitle'),
                  },
                ],
              },
            ],
            footer: {
              id: 'base64',
              label: i18next.t('settings.attachments.policies.base64.label'),
            },
          },
          'medium'
        );

      const handle = (event: FormEvent) => {
        if (event.op === 'dismiss') finish('cancel');
        if (event.op !== 'press') return;
        if (event.id === 'cancel') finish('cancel');
        if (event.id === 'base64') finish('base64');
        if (event.id === 'save-document') finish('save-document');
      };

      const form = new NativeForm('image-unsaved', view, handle);
      form.show();
    });
  }
}
