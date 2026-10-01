import { basenamePath } from '../features/attachment-paths';
import { i18next } from '../i18n';

/** The name shown for the document; one never saved gets a translated name. */
export function documentFileName(filePath: string | null) {
  return (filePath && basenamePath(filePath)) || i18next.t('shell.untitled');
}
