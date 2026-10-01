import { expect, test } from 'bun:test';
import { Store } from '../src/state/store';

test('update notifies only when a field actually changes', () => {
  const store = new Store();
  let calls = 0;
  store.subscribe(() => calls++);
  expect(calls).toBe(1);

  store.update({ isDirty: false, wordCount: 0 });
  expect(calls).toBe(1);

  store.update({ isDirty: true });
  expect(calls).toBe(2);
  expect(store.getState().isDirty).toBe(true);

  store.update({ isDirty: true, lineCount: 1 });
  expect(calls).toBe(2);
});
