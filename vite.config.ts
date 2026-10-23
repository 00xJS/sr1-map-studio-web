import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  worker: { format: 'es' },
  // The AI chat's relay (netlify/functions/ai.mts) during development: straight through to NVIDIA.
  server: { proxy: { '/api/ai': { target: 'https://integrate.api.nvidia.com', changeOrigin: true, rewrite: () => '/v1/chat/completions' } } },
  build: { target: 'es2022', chunkSizeWarningLimit: 1500 },
  test: { include: ['tests/**/*.test.ts'] },
} as any)
