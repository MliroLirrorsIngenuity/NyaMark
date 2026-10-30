import { afterAll, describe, expect, mock, test } from 'bun:test';
import { parseHTML } from 'linkedom';

let mobile = true;
const windowTheme = mock(async () => 'light' as const);
mock.module('../src/bridge/ipc/windows', () => ({
  getWindowTheme: windowTheme,
  setWindowTheme: async () => {},
  listenWindowThemeChange: async () => () => {},
}));
mock.module('../src/platform/detect', () => ({
  isMobilePlatform: () => mobile,
}));
mock.module('../src/state/settings', () => ({
  getSettings: () => ({ appearance: { theme: 'auto' } }),
  registerThemeApplier: (apply: ((theme: string) => void) | null) =>
    apply?.('auto'),
  updateSettings: async () => {},
}));

const page = parseHTML('<html><body></body></html>');
const darkSystem = {
  matches: true,
  addEventListener: () => {},
  removeEventListener: () => {},
};
const stand = {
  window: globalThis,
  matchMedia: () => darkSystem,
  document: page.document,
  localStorage: { getItem: () => null, removeItem: () => {} },
};
const had = Object.fromEntries(
  Object.keys(stand).map((key) => [key, Reflect.get(globalThis, key)])
);
Object.assign(globalThis, stand);
afterAll(() => {
  for (const [key, value] of Object.entries(had)) {
    if (value === undefined) Reflect.deleteProperty(globalThis, key);
    else Reflect.set(globalThis, key, value);
  }
});

const { ThemeManager } = await import('../src/ui/theme');
const settled = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('the system theme', () => {
  test('on a phone it is the page colour scheme, the window reporting light whatever the system shows', async () => {
    mobile = true;
    const theme = new ThemeManager();
    await settled();
    expect(theme.getMode()).toBe('dark');
    expect(windowTheme).not.toHaveBeenCalled();
    theme.destroy();
  });

  test('on a computer it is what the window reports', async () => {
    mobile = false;
    const theme = new ThemeManager();
    await settled();
    expect(theme.getMode()).toBe('light');
    theme.destroy();
  });
});
