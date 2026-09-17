import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { db } from './db.js';
import { logger } from './logger.js';

const currentFile = fileURLToPath(import.meta.url);
const migrationsDirectory = path.resolve(path.dirname(currentFile), '../../../../db/migrations');

async function migrate() {
  await db.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename varchar(255) PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `);

  const filenames = (await readdir(migrationsDirectory))
    .filter((filename) => filename.endsWith('.sql'))
    .sort();
  for (const filename of filenames) {
    const applied = await db.query('SELECT 1 FROM schema_migrations WHERE filename = $1', [
      filename,
    ]);
    if (applied.rowCount) continue;

    const sql = await readFile(path.join(migrationsDirectory, filename), 'utf8');
    const client = await db.connect();
    try {
      await client.query('BEGIN');
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations (filename) VALUES ($1)', [filename]);
      await client.query('COMMIT');
      logger.info({ filename }, 'Migration applied');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
}

migrate()
  .then(() => db.end())
  .catch(async (error: unknown) => {
    logger.error({ error }, 'Migration failed');
    await db.end();
    process.exitCode = 1;
  });
