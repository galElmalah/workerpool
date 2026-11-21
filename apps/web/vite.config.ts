import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { cloudflare } from '@cloudflare/vite-plugin';

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    cloudflare({
      // E2E runs and parallel dev sessions point this at an isolated state dir.
      persistState: process.env.CF_PERSIST_TO ? { path: process.env.CF_PERSIST_TO } : true,
    }),
  ],
  // Parallel dev sessions can isolate the optimizer cache.
  cacheDir: process.env.VITE_CACHE_DIR ?? 'node_modules/.vite',
  resolve: { alias: { '@': new URL('./src', import.meta.url).pathname } },
});
