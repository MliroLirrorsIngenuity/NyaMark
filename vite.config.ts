import { defineConfig } from 'vite';
import tailwindcss from '@tailwindcss/vite';

// @ts-expect-error process is a nodejs global
const env = process.env;
const host = env.TAURI_DEV_HOST;
const debug = !!env.TAURI_ENV_DEBUG;

// https://vite.dev/config/
export default defineConfig(async () => ({
  plugins: [tailwindcss()],
  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: 'ws',
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // 3. tell Vite to ignore watching `src-tauri`
      ignored: ['**/src-tauri/**'],
    },
  },
  // 4. expose Tauri's build-time variables (TAURI_ENV_PLATFORM, ...) next to VITE_*
  envPrefix: ['VITE_', 'TAURI_ENV_'],
  build: {
    // WebView2 is Chromium; macOS and Linux run WebKit
    target: env.TAURI_ENV_PLATFORM === 'windows' ? 'chrome105' : 'safari13',
    minify: debug ? false : 'esbuild',
    sourcemap: debug,
  },
}));
