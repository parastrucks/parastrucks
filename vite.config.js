import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig(({ mode }) => ({
  plugins: [react()],
  server: { port: parseInt(process.env.PORT || '3000') },
  esbuild: {
    drop: mode === 'production' ? ['console', 'debugger'] : [],
  },
  // pdfjs-dist (9.7c cover generation) must NOT be pre-bundled: optimizeDeps
  // transforms the main import into a different instance than the ?worker
  // build, so their internal API-version constants mismatch and page.render()
  // deadlocks against the worker. Excluding it keeps main + worker paired.
  optimizeDeps: { exclude: ['pdfjs-dist'] },
}))
