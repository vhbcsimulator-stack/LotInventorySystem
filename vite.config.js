import react from '@vitejs/plugin-react'
import path from 'node:path'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      // The portal, and the public map gallery served at /maps/.
      input: {
        main: path.resolve(import.meta.dirname, 'index.html'),
        maps: path.resolve(import.meta.dirname, 'maps/index.html'),
      },
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, './src'),
    },
  },
})
