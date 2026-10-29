export type NativeSettingsTab = 'general' | 'ai';

/** Opens the native settings at `tab`; `addService` as `SettingsPanel.open`. */
export function openNativeSettings(
  _tab: NativeSettingsTab = 'general',
  _options: { addService?: string } = {}
) {}
