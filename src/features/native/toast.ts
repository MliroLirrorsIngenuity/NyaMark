import { presentToastsWith } from '../../ui/toast';
import { postPanel } from './panels';

/** Has the native shell draw the notes the page raises, instead of the page. */
export function bindNativeToast() {
  presentToastsWith((title, detail, kind, duration) => {
    postPanel('toast', 'show', { title, detail, kind, duration });
  });
}
