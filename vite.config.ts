import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

// base './' keeps the build relocatable (npx server, GitHub Pages sub-path).
// The bundle is emitted as a classic (IIFE) script so dist/index.html also
// opens straight from file:// (browsers block external module scripts there).
export default defineConfig({
  base: './',
  plugins: [
    react(),
    {
      name: 'classic-script-html',
      enforce: 'post',
      transformIndexHtml(html) {
        return html
          .replace(/<script type="module" crossorigin /g, '<script defer ')
          .replace(/<script type="module" /g, '<script defer ')
          .replace(/ crossorigin(?=[ >])/g, '')
      },
    },
  ],
  build: { rollupOptions: { output: { format: 'iife' } } },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'bin/**/*.test.ts'],
  },
})
