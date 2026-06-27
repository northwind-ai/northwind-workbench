import { builtinModules } from 'node:module';
import { resolve } from 'node:path';
import { defineConfig } from 'vite';

/**
 * Standalone build for the Electron engine worker (utilityProcess). Built on its
 * own — not as a second electron-vite "main" entry — so it gets a single
 * self-contained CJS bundle (no code-splitting that breaks the CJS interop).
 * The internal workspace packages (core/plugin-sdk/…) are bundled in; Node
 * built-ins + electron stay external. Output: out/main/worker.js.
 */
export default defineConfig({
  build: {
    outDir: 'out/main',
    emptyOutDir: false,
    target: 'node18',
    minify: false,
    lib: {
      entry: resolve(__dirname, 'src/worker/index.ts'),
      formats: ['cjs'],
      fileName: () => 'worker.js',
    },
    rollupOptions: {
      external: ['electron', ...builtinModules, ...builtinModules.map((m) => `node:${m}`)],
    },
  },
});
