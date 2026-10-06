import { expect, test } from 'bun:test';
import capability from '../src-tauri/capabilities/default.json';
import tauriConfig from '../src-tauri/tauri.conf.json';

// The page reads files through the fs plugin and through the asset protocol,
// and Tauri keeps a scope for each: a folder kept from one is kept from both.
test('the fs plugin and the asset protocol reach the same files', () => {
  const fs = capability.permissions.find(
    (permission) =>
      typeof permission === 'object' && permission.identifier === 'fs:scope'
  );
  if (typeof fs !== 'object') throw new Error('no fs:scope');
  const paths = (entries: { path: string }[]) =>
    entries.map((entry) => entry.path);
  const { scope } = tauriConfig.app.security.assetProtocol;
  expect(paths(fs.allow)).toEqual(scope.allow);
  expect(paths(fs.deny)).toEqual(scope.deny);
});
