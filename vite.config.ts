import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Electron renderer build. `base: './'` makes asset URLs relative so the
// production bundle loads correctly from a file:// path inside the packaged app.
export default defineConfig({
  base: './',
  plugins: [react()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    chunkSizeWarningLimit: 1500,
  },
  server: {
    port: 5173,
    strictPort: true,
  },
});
