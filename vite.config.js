import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Renderer (UI React) chay tren Vite dev server o cong 5173.
// base './' de khi build production Electron load duoc bang file://
export default defineConfig({
  root: 'src/renderer',
  base: './',
  plugins: [react()],
  server: { port: 5173, strictPort: true },
  build: {
    outDir: '../../dist',
    emptyOutDir: true
  }
})
