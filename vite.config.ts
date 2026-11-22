import path from 'node:path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// Served from https://icodewithvibes.github.io/bubbles/, so every asset lives under /bubbles/.
export default defineConfig({
  base: '/bubbles/',
  plugins: [react(), tailwindcss()],
  resolve: { alias: { '@': path.resolve(__dirname, 'src') } },
  build: {
    target: 'es2022',
    rollupOptions: {
      output: {
        // Firebase and the Whisper runtime are big and rarely change: own chunks so app updates stay small.
        manualChunks: (id: string) => (id.includes('node_modules/@firebase/') || id.includes('node_modules/firebase/') ? 'firebase' : undefined),
      },
    },
  },
  worker: { format: 'es' },
})
