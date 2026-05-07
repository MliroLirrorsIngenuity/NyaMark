import { listenAppMenuAction, type AppMenuAction } from '../bridge/ipc/menu';

type MenuHandlers = Record<AppMenuAction, () => void>;

export class MenuController {
  constructor(private readonly handlers: MenuHandlers) {}

  async bind() {
    await listenAppMenuAction((action) => {
      this.handlers[action]?.();
    });
  }
}
