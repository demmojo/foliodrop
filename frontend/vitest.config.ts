import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  plugins: [react() as any],
  test: {
    environment: 'happy-dom',
    globals: true,
    setupFiles: ['./test-setup.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.{ts,tsx}'],
      exclude: ['src/**/*.d.ts'],
      // Full UI (UploadFlow export/share, WebGL, login !auth) needs E2E or very heavy mocks
      // for 100% line+branch. Store and utils are at or near 100% after the latest tests.
      thresholds: {
        lines: 93,
        functions: 87,
        branches: 84,
        statements: 93
      }
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src')
    }
  }
})
