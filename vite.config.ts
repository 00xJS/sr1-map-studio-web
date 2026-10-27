import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { devGameFiles } from './scripts/devGameFiles'
import { devMaps } from './scripts/devMaps'

export default defineConfig(({ mode }) => ({
  plugins: [react(), devGameFiles(), devMaps()],
  worker: { format: 'es' },
  // The AI chat's relay (netlify/edge-functions/ai.ts) during development: straight through to NVIDIA.
  // The model list comes back as NVIDIA's own {data: [{id}]}; listModels reads both shapes.
  server: { proxy: { '/api/ai': { target: 'https://integrate.api.nvidia.com', changeOrigin: true, rewrite: (path: string) => (path.startsWith('/api/ai/models') ? '/v1/models' : '/v1/chat/completions') } } },
  build: { target: 'es2022', chunkSizeWarningLimit: 1500 },
  // `vitest --mode game` / `--mode full` turn on the slower checks (tests/testMode.ts).
  test: { include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx'], exclude: ['tests/e2e/**'], env: { SR1_TEST_MODE: mode } },
}) as any)
