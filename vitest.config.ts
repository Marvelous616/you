import { defineConfig } from 'vitest/config';
import * as path from 'node:path';

export default defineConfig({
  resolve: {
    alias: {
      '@life-logger/domain': path.resolve(__dirname, 'packages/domain/src/index.ts'),
      '@life-logger/persistence': path.resolve(__dirname, 'packages/persistence/src/index.ts'),
      '@life-logger/sync': path.resolve(__dirname, 'packages/sync/src/index.ts'),
    },
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['**/*.test.ts'],
    exclude: ['**/node_modules/**', '**/dist/**', 'packaging/**'],
  },
});
