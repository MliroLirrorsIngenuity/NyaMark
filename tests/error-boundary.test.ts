import { describe, expect, test } from 'bun:test';
import {
  createErrorReporter,
  describeError,
} from '../src/features/error-boundary';

function deferred() {
  let resolve!: () => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('describeError', () => {
  test('uses the message of an Error and the text of a string', () => {
    expect(describeError(new TypeError('boom'))).toBe('boom');
    expect(describeError('plain')).toBe('plain');
  });

  test('falls back to the name of an Error without a message', () => {
    expect(describeError(new RangeError())).toBe('RangeError');
  });

  test('serializes other values', () => {
    expect(describeError({ code: 3 })).toBe('{"code":3}');
    expect(describeError(undefined)).toBe('undefined');
  });
});

describe('createErrorReporter', () => {
  test('shows each message once', async () => {
    const shown: string[] = [];
    const report = createErrorReporter(async (text) => {
      shown.push(text);
    });
    report(new Error('a'));
    await Promise.resolve();
    await Promise.resolve();
    report(new Error('a'));
    expect(shown).toEqual(['a']);
  });

  test('drops errors raised while a dialog is open', async () => {
    const shown: string[] = [];
    const dialog = deferred();
    const report = createErrorReporter((text) => {
      shown.push(text);
      return dialog.promise;
    });
    report(new Error('first'));
    report(new Error('second'));
    expect(shown).toEqual(['first']);

    dialog.resolve();
    await dialog.promise;
    await Promise.resolve();
    report(new Error('second'));
    expect(shown).toEqual(['first', 'second']);
  });

  test('recovers when the dialog itself fails', async () => {
    const shown: string[] = [];
    const dialog = deferred();
    const report = createErrorReporter((text) => {
      shown.push(text);
      return dialog.promise;
    });
    const originalError = console.error;
    console.error = () => {};
    try {
      report(new Error('first'));
      dialog.reject(new Error('no dialog'));
      await dialog.promise.catch(() => {});
      await Promise.resolve();
      await Promise.resolve();
    } finally {
      console.error = originalError;
    }
    report(new Error('second'));
    expect(shown).toEqual(['first', 'second']);
  });

  test('ignores ResizeObserver loop notices', () => {
    const shown: string[] = [];
    const report = createErrorReporter(async (text) => {
      shown.push(text);
    });
    report('ResizeObserver loop completed with undelivered notifications.');
    expect(shown).toEqual([]);
  });
});
