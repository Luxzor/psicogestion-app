import { defineConfig } from 'vitest/config';

const thresholds =
  process.env.RUN_INTEGRATION_TESTS === '1'
    ? { branches: 40, functions: 55, lines: 55, statements: 55 }
    : { branches: 5, functions: 9, lines: 20, statements: 20 };

export default defineConfig({
  test: {
    environment: 'node',
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['src/**/*.ts'],
      exclude: ['src/server.ts', 'src/platform/migrate.ts'],
      thresholds,
    },
  },
});
