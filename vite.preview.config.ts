import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'

export default defineConfig({
  root: 'src/renderer',
  plugins: [react()],
  resolve: { alias: { '@renderer': resolve('src/renderer'), '@shared': resolve('src/shared') } },
  server: { port: 4173, strictPort: true },
  build: { outDir: '../../dist-preview' }
})
