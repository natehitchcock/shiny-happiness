import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // The API is same-origin in production; in development it is proxied so the
    // browser never needs CORS and the client can use relative paths throughout.
    proxy: { '/api': { target: process.env['API_URL'] ?? 'http://127.0.0.1:3111' } },
  },
  build: { outDir: 'dist-web' },
})
