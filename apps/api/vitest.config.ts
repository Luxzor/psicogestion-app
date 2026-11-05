import { defineConfig } from 'vitest/config';

const thresholds =
  process.env.RUN_INTEGRATION_TESTS === '1'
    ? { branches: 40, functions: 55, lines: 55, statements: 55 }
    : { branches: 5, functions: 9, lines: 20, statements: 20 };

export default defineConfig({
  test: {
    environment: 'node',
    // Las suites de integración comparten una sola base de pruebas y cada una la vacía con
    // TRUNCATE en su beforeEach. Con la suite del modelo de salas y citas (EDT 5.2.1) ya son
    // cuatro archivos; en paralelo, el TRUNCATE de uno borraba los datos de otro a media prueba.
    fileParallelism: process.env.RUN_INTEGRATION_TESTS !== '1',
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['src/**/*.ts'],
      exclude: ['src/server.ts', 'src/platform/migrate.ts'],
      thresholds,
    },
  },
});
