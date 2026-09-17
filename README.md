# PsicoGestión

Plataforma administrativa para la clínica SEAP de la Facultad de Psicología, UADY.

## Inicio rápido

1. Ejecuta `mkcert -install` una vez desde una terminal local y confirma la contraseña de macOS.
2. Ejecuta `mkcert -cert-file infra/certs/localhost.pem -key-file infra/certs/localhost-key.pem localhost 127.0.0.1 ::1`.
3. Ejecuta `npm install`.
4. Ejecuta `npm run docker:up`.

Servicios disponibles:

- Aplicación: `https://localhost:8443`
- API: `https://localhost:8443/api/v1/health`
- Redirección HTTP: `http://localhost:18080`
- Mailpit: `http://localhost:8025`

## Acceso a la base de datos de desarrollo

La aplicación utiliza PostgreSQL dentro del servicio Docker `db`. Internamente,
la API se conecta usando el host `db` y el puerto `5432`:

```text
api → db:5432
```

Para permitir conexiones desde herramientas instaladas en el equipo local,
Docker publica ese PostgreSQL en el puerto `5434` del host:

```text
localhost:5434 → db:5432
```

El puerto `5432` del equipo local no se utiliza porque puede estar ocupado por
otra instalación de PostgreSQL.

### Conexión desde DbGate o cualquier cliente PostgreSQL

Usa los siguientes valores para la base de desarrollo local:

```text
Motor: PostgreSQL
Host: localhost
Puerto: 5434
Base de datos: psicogestion
Usuario: psicogestion
Contraseña: psicogestion_dev_password
SSL: desactivado
Esquema: public
```

La contraseña anterior corresponde únicamente al entorno local definido en
`.env`; nunca debe reutilizarse en producción.

### Conexión desde la terminal

Desde la raíz del proyecto puedes entrar directamente al contenedor:

```bash
docker compose exec db sh -lc \
  'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"'
```

Consultas útiles dentro de PostgreSQL:

```sql
\dt

SELECT id, nombre_completo, correo_institucional, estado, rol
FROM usuario;

SELECT id, id_usuario, selector, emitido_en, expira_en, consumido_en
FROM token_recuperacion
ORDER BY emitido_en DESC;
```

Para salir de PostgreSQL:

```sql
\q
```

### Diferencia con la base de pruebas

La base de desarrollo y la base de pruebas son independientes. La base de
pruebas se publica en el puerto `5433` y no contiene necesariamente los datos
creados desde la aplicación:

```text
Host: localhost
Puerto: 5433
Base de datos: psicogestion_test
Usuario: psicogestion_test
Contraseña: psicogestion_test_password
```

Las pruebas automatizadas pueden limpiar sus tablas, por lo que no deben
ejecutarse contra la base `psicogestion` de desarrollo.

## Módulo de cuentas — Iteración 1

La aplicación implementa registro, verificación de correo, inicio y cierre de sesión y recuperación de contraseña. La API se documenta en `docs/openapi.yaml`; para probar los correos de verificación y recuperación usa Mailpit.

Las pantallas están disponibles en:

- `/registro`
- `/verificar`
- `/iniciar-sesion`
- `/recuperar`
- `/restablecer?token=...`

## Calidad

- `npm run lint`
- `npm run format:check`
- `npm test`
- `npm run test:integration`
- `npm run test:coverage`
- `npm run typecheck`

## Pruebas de integración

1. Copia `.env.test.example` a `.env.test` y ajusta valores locales si es necesario.
2. Ejecuta `docker compose -f docker-compose.test.yml up -d`.
3. Ejecuta `npm run migrate -w @psicogestion/api`.
4. Ejecuta `npm run test:integration`.
5. Al terminar, ejecuta `docker compose -f docker-compose.test.yml down -v`.

Las pruebas de integración usan PostgreSQL y Redis exclusivos; no deben apuntar al entorno de desarrollo o a datos reales.

La cobertura se publica en cada ejecución de CI. La suite de integración aplica umbrales más exigentes a la API (40% de ramas y 55% de funciones, líneas y sentencias); la ejecución local conserva umbrales básicos para poder trabajar sin los contenedores de prueba. Estos umbrales deben elevarse después de incorporar los casos restantes de verificación, logout y fallos de dependencias.
