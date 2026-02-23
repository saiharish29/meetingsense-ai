import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    // Default environment for React component tests
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/__tests__/setup.ts'],
    // Include both frontend (src) and backend (server) tests
    include: [
      'src/__tests__/**/*.test.{ts,tsx}',
      'server/__tests__/**/*.test.{js,ts}',
    ],
    // Server-side tests run in Node environment; frontend tests use jsdom above.
    // Per-file environment overrides (// @vitest-environment node) are respected
    // by vitest automatically when environmentMatchGlobs is configured.
    environmentMatchGlobs: [
      ['server/__tests__/**', 'node'],
    ],
  },
});
