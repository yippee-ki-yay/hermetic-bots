import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    resolve: {
      alias: { '@shared': resolve(__dirname, 'src/shared') },
    },
    build: {
      lib: { entry: 'src/main/index.ts' },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    resolve: {
      alias: { '@shared': resolve(__dirname, 'src/shared') },
    },
    build: {
      lib: { entry: 'src/preload/index.ts' },
    },
  },
  renderer: {
    plugins: [
      react(),
      {
        // Dev-only: the React fast-refresh preamble is an inline script, so
        // relax script-src for the dev server. Production keeps strict CSP.
        name: 'dev-csp-relax',
        apply: 'serve',
        transformIndexHtml(html: string) {
          return html.replace("script-src 'self'", "script-src 'self' 'unsafe-inline'");
        },
      },
    ],
    resolve: {
      alias: { '@shared': resolve(__dirname, 'src/shared') },
    },
    root: 'src/renderer',
    build: {
      rollupOptions: { input: resolve(__dirname, 'src/renderer/index.html') },
    },
  },
});
