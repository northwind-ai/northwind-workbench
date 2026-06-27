import { resolve } from 'node:path';
import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import react from '@vitejs/plugin-react';

// Bundle the internal workspace packages into the main/preload output (they point
// at TypeScript source in dev). Keep node/electron + real npm deps external.
const WORKSPACE = [
  '@package-workbench/core',
  '@package-workbench/ui',
  '@package-workbench/plugin-sdk',
  '@package-workbench/nx-adapter',
  '@package-workbench/chat-engine',
];

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin({ exclude: WORKSPACE })],
    build: {
      // The engine worker is built separately (vite.worker.config.ts) to avoid
      // multi-entry code-splitting, then emitted alongside into out/main/.
      rollupOptions: { input: resolve(__dirname, 'src/main/index.ts') },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin({ exclude: WORKSPACE })],
    build: {
      // Emit CommonJS (.cjs) — a sandboxed renderer's preload must be CJS, and
      // the explicit extension is unambiguous under the package's "type":"module".
      rollupOptions: {
        input: resolve(__dirname, 'src/preload/index.ts'),
        output: { format: 'cjs', entryFileNames: '[name].cjs' },
      },
    },
  },
  renderer: {
    root: resolve(__dirname, 'src/renderer'),
    plugins: [react()],
    build: {
      rollupOptions: { input: resolve(__dirname, 'src/renderer/index.html') },
    },
  },
});
