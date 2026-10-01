import { describe, expect, test } from 'bun:test';
import {
  altFromImageAttrs,
  imageAttrsFromAlt,
} from '../src/editor/plugins/image-alt';

/** What a save writes back for the alt text an image was opened with. */
function roundTrip(alt: string) {
  const attrs = imageAttrsFromAlt(alt);
  return altFromImageAttrs(attrs.alt, attrs.ratio);
}

describe('image alt text', () => {
  test('keeps the alt text', () => {
    expect(roundTrip('猫')).toBe('猫');
    expect(roundTrip('Figure 2')).toBe('Figure 2');
    expect(roundTrip('2024')).toBe('2024');
  });

  test('keeps an empty alt empty', () => {
    expect(roundTrip('')).toBe('');
    expect(imageAttrsFromAlt(undefined)).toEqual({ alt: '', ratio: 1 });
  });

  test("reads Milkdown's ratio and drops its 1.00", () => {
    expect(imageAttrsFromAlt('0.50')).toEqual({ alt: '', ratio: 0.5 });
    expect(roundTrip('0.50')).toBe('0.50');
    expect(roundTrip('1.00')).toBe('');
  });

  test('a resized image writes its ratio', () => {
    expect(altFromImageAttrs('猫', 0.5)).toBe('0.50');
    expect(altFromImageAttrs('猫', 1)).toBe('猫');
    expect(altFromImageAttrs('', 1.004)).toBe('');
  });
});
