import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// U razvoju (npm run dev) zahtevi ka /api idu na Go server.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: { '/api': 'http://localhost:8080' },
  },
})
