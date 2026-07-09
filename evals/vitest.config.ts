import path from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '..'),
    },
  },
  test: {
    environment: 'node',
    include: ['evals/**/*.eval.ts', 'evals/**/*.test.ts'],
    testTimeout: 300_000,
    hookTimeout: 300_000,
  },
});
