import { message } from '@tauri-apps/plugin-dialog';
import { App } from './bootstrap';

window.addEventListener('DOMContentLoaded', () => {
  const app = new App();
  app.init().catch((error: unknown) => {
    console.error(error);
    void message(String(error), { kind: 'error' });
  });
});
