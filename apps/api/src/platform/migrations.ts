import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const currentFile = fileURLToPath(import.meta.url);

/** db/migrations en la raíz del repositorio; también existe en la imagen de la API. */
export const migrationsDirectory = path.resolve(
  path.dirname(currentFile),
  '../../../../db/migrations',
);

/** Archivos de migración en el orden en que se aplican. */
export async function listMigrationFiles() {
  return (await readdir(migrationsDirectory)).filter((name) => name.endsWith('.sql')).sort();
}
