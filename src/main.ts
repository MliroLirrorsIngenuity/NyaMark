import { App } from './bootstrap';
import { errorDialog } from './bridge/ipc/files';
import { installErrorBoundary } from './features/error-boundary';

installErrorBoundary();

window.addEventListener('DOMContentLoaded', () => {
  const app = new App();
  app.init().catch((error: unknown) => {
    console.error(error);
    void errorDialog(String(error));
  });
});
