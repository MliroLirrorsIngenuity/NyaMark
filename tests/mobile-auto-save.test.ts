import {
  afterAll,
  beforeEach,
  describe,
  expect,
  setSystemTime,
  test,
} from 'bun:test';

const timers = new Map<number, () => void>();
let nextTimer = 1;
let page = Object.assign(new EventTarget(), { visibilityState: 'visible' });
Object.assign(globalThis, {
  window: {
    setTimeout: (run: () => void) => {
      timers.set(nextTimer, run);
      return nextTimer++;
    },
    clearTimeout: (id: number) => timers.delete(id),
  },
  document: page,
});

const { bindMobileAutoSave } = await import('../src/features/auto-save');

function runTimers() {
  const due = [...timers.values()];
  timers.clear();
  for (const run of due) run();
}

let saves = 0;
const save = async () => {
  saves += 1;
};

beforeEach(() => {
  timers.clear();
  saves = 0;
  page = Object.assign(new EventTarget(), { visibilityState: 'visible' });
  Object.assign(globalThis, { document: page });
  setSystemTime(new Date('2026-10-29T12:00:00Z'));
});

afterAll(() => {
  setSystemTime();
});

describe('saving on a phone', () => {
  test('waits for a pause in typing', () => {
    const edited = bindMobileAutoSave(save);
    edited();
    edited();
    expect(saves).toBe(0);
    runTimers();
    expect(saves).toBe(1);
  });

  test('saves within ten seconds while typing goes on', () => {
    const edited = bindMobileAutoSave(save);
    edited();
    setSystemTime(new Date('2026-10-29T12:00:09Z'));
    edited();
    expect(saves).toBe(0);
    setSystemTime(new Date('2026-10-29T12:00:10Z'));
    edited();
    expect(saves).toBe(1);
  });

  test('saves at once when the app leaves the screen', () => {
    const edited = bindMobileAutoSave(save);
    edited();
    page.visibilityState = 'hidden';
    page.dispatchEvent(new Event('visibilitychange'));
    expect(saves).toBe(1);
  });
});
