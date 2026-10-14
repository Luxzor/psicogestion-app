# Base de datos

## Migraciones

Las migraciones viven en `db/migrations/` con nombre `NNNN_descripcion.sql` y se aplican en
orden alfabético. Cada archivo se ejecuta una sola vez dentro de una transacción y queda
registrado en la tabla `schema_migrations`.

```
npm run migrate -w @psicogestion/api
```

Reglas:

- Las migraciones son **idempotentes** (`IF NOT EXISTS`, `CREATE OR REPLACE`).
- Una migración **ya fusionada no se edita**; el cambio va en una migración nueva.
- Cada migración lleva su reversa en `db/rollback/` con el mismo nombre de archivo.

## Reversa

Los scripts de `db/rollback/` no los ejecuta el runner: se aplican a mano, en orden inverso al
de las migraciones, con el cliente de PostgreSQL. Cada script borra además su fila de
`schema_migrations`, de modo que la migración pueda volver a aplicarse después.

```
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f db/rollback/0007_paciente_busqueda.sql
```

Verifica una reversa siempre contra la base de datos de pruebas
(`docker compose -f docker-compose.test.yml up -d db-test`), nunca contra la de desarrollo.
