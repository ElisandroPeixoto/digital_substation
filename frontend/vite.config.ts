import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Em desenvolvimento, as chamadas /api vão para o backend FastAPI (porta 8000).
export default defineConfig({
  plugins: [react()],
  // Imagens da identidade visual ficam em ../assets e são servidas na raiz (/eclipse-logo.png etc.).
  publicDir: '../assets',
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://127.0.0.1:8000',
    },
  },
})
