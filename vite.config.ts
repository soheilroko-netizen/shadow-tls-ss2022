import { defineConfig } from 'vite'
import { svelte } from '@sveltejs/vite-plugin-svelte'

export default defineConfig({
  base: '',
  clearScreen: false,
  server: {
    host: true,
    port: 1420,
    strictPort: true,
  },
  build: {
    target: 'es2022',
    outDir: 'dist',
    rollupOptions: {
      input: {
        main: 'index.html',
        settings: 'settings.html',
      },
    },
  },
  plugins: [svelte()],
})