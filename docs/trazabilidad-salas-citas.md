# Trazabilidad ERS. Administración de salas y citas

## Ajustes al modelo de datos de salas y citas (EDT 5.2.1)

Esta implementación cubre la actividad 5.2.1 del cronograma (PG-RHT-001 v0.3.1), con las entidades Sala y Cita de PG-ERS-001 v0.6.3 (sección 3.4), los criterios de aceptación de PG-PLI-003 v0.1.0 y el diseño de PG-DSN-003 v0.1.0 (sección 4, apéndice 11.2; ADR-15 a ADR-23). Para el cliente se toma como base la maqueta PG-DSN-003-INT v0.1.0.

El alcance es el modelo de datos y su capa de acceso, en la base, en la API y en el cliente. Los endpoints, servicios, correo de confirmación y pantallas corresponden a las tareas 5.3.1 a 5.3.6, que se apoyan en lo que aquí se entrega.

### Base de datos

| Diseño                               | Implementación                                                                                                                                                                                                       |
| ------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| PG-DSN-003 4.1, 11.1                 | Migración aditiva `db/migrations/0009_sala_cita.sql`, idempotente, con su reversa en `db/rollback/0009_sala_cita.sql`. No modifica las tablas de las iteraciones anteriores.                                         |
| 4.3.1, RF 4.1.3, RF 4.1.4, RNF 4.1.2 | Tabla `sala`: `nombre varchar(10)` con `sala_nombre_no_vacio` (1 a 10 caracteres sin espacios laterales) e índice único `uq_sala_nombre` sobre `lower(btrim(nombre))`, que también abarca a las salas dadas de baja. |
| ADR-19, DESV-09                      | Baja lógica de sala: `activo`, `fecha_baja`, `baja_por` y `sala_baja_coherente`. Las citas la referencian con `ON DELETE RESTRICT`.                                                                                  |
| 4.3.2, RF 5.1.5, RF 5.2.2            | Tabla `cita` con el tipo `cita_estado` (Pendiente, Cancelada, Vencida); nace Pendiente.                                                                                                                              |
| ADR-17, RF 5.1.12, RNF 5.1.2         | Folio `C` + año de dos dígitos + 6 dígitos (por ejemplo `C26000001`) generado en el mismo `INSERT` con `cita_folio_seq`, único (`uq_cita_folio`) y con formato verificado (`cita_folio_formato`).                    |
| ADR-15, DESV-07, RF 6.2.2            | Sin tablas de bloques: `inicio` y `fin` en `timestamptz` con `cita_rejilla_30min`, `cita_mismo_dia`, `cita_horario_operativo` (07:00 a 17:00 hora de Mérida) y `cita_rango_valido`.                                  |
| ADR-16, ERS 3.7, CA-5.1-04           | Restricciones `EXCLUDE USING gist` por sala, terapeuta y paciente sobre `tstzrange(inicio, fin)`, solo para citas Pendientes (extensión `btree_gist`). Las citas contiguas se aceptan.                               |
| ADR-20                               | Cancelar no borra: `cancelada_en`, `cancelada_por` y `cita_cancelacion_coherente`.                                                                                                                                   |
| ADR-23                               | Columna `version` con `CHECK (version >= 1)` en ambas tablas para el control optimista.                                                                                                                              |
| 4.4, RNF 5.1.1, RNF 5.1.4            | Índices `idx_cita_inicio`, `idx_cita_estado_inicio`, `idx_cita_sala_inicio`, `idx_cita_terapeuta_inicio` e `idx_cita_paciente_inicio`.                                                                               |
| ERS 3.4 (retención)                  | Todas las llaves foráneas de la cita hacia paciente, terapeuta y sala son `ON DELETE RESTRICT`; las de auditoría hacia usuario, `ON DELETE SET NULL`.                                                                |

### API (capa de datos)

| Diseño                        | Implementación                                                                                                                                                                                                                                        |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ADR-15, 4.5                   | `apps/api/src/modules/citas/horario.ts`: constantes de la rejilla, conversión entre la hora de la clínica (`CLINIC_TIME_ZONE`) y UTC, los 20 bloques del día y `evaluarHorario()`, que devuelve `HORARIO_INVALIDO` o `CITA_EN_EL_PASADO`.             |
| 4.5 (sala.nombre)             | `apps/api/src/modules/salas/schemas.ts`: recorte, colapso de espacios y 1 a 10 caracteres; alta y cambio de nombre con `version`, cuerpos estrictos.                                                                                                  |
| 4.5 (cita), 5.7               | `apps/api/src/modules/citas/schemas.ts`: alta sin `estado` ni `folio`, UUID en minúsculas, `inicio` ISO 8601 con zona, `duracion_bloques` de 1 a 4; modificación parcial con `version`; cancelación; folio normalizado.                               |
| 4.3.1, ADR-19                 | `apps/api/src/modules/salas/repository.ts`: consulta, listado por estado, unicidad anticipada, alta, cambio de nombre con versión, conteo de citas pendientes, baja y reactivación.                                                                   |
| 4.3.2, ADR-17, ADR-18, ADR-21 | `apps/api/src/modules/citas/repository.ts`: alta con folio en un solo viaje, consulta por id y folio, modificación y cancelación con versión, marcado de Vencidas, ocupación por periodo y lectura con `FOR SHARE` de los recursos.                   |
| ADR-16, 5.7.1                 | `apps/api/src/modules/citas/errors.ts` y `apps/api/src/modules/salas/errors.ts`: traducen 23P01, 23514, 23503, 23505 y 22001 a `SALA_OCUPADA`, `TERAPEUTA_OCUPADO`, `PACIENTE_OCUPADO`, `HORARIO_INVALIDO`, `*_NO_ENCONTRADO` y `NOMBRE_SALA_EN_USO`. |
| 4.6, R01                      | La cita solo une el nombre del paciente y del terapeuta; nunca CURP, teléfono ni correo. El correo del paciente se lee únicamente al bloquear los recursos, para decidir el envío de la confirmación.                                                 |

### Cliente (modelo de datos)

| Diseño             | Implementación                                                                                                                                                                            |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 4.3.1, 5.7         | `apps/web/src/features/salas/types.ts`: sala, cuerpos de alta y edición, filtro por estado y respuesta de disponibilidad.                                                                 |
| 5.3, maqueta       | `apps/web/src/features/salas/validation.ts`: mismas reglas del nombre que el servidor, textos de la maqueta, cuerpo de edición solo con cambios y versión.                                |
| 4.3.2, 5.7         | `apps/web/src/features/citas/types.ts`: cita, estados, confirmación de correo, cuerpos de alta, modificación y cancelación, filtros de la lista, valores y errores del formulario.        |
| ADR-15, maqueta    | `apps/web/src/features/citas/horario.ts`: rejilla de 07:00 a 17:00, duraciones de 30 minutos a 2 horas, conversión a UTC independiente de la zona del navegador.                          |
| 5.4 a 5.6, maqueta | `apps/web/src/features/citas/validation.ts`: validación del formulario de agendar y modificar, cuerpo del alta y del PATCH, folio, pestañas por estado y catálogo de mensajes por código. |

### Evidencia de calidad

| Requisito / criterio                                            | Casos automatizados                                                                                                       |
| --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| CA-4.1-01 a CA-4.1-03                                           | `apps/api/test/salas.schemas.test.ts`, `apps/api/test/modelo-salas-citas.integration.test.ts`, `salas/validation.test.ts` |
| CA-4.2-01, CA-4.2-02 (baja lógica y conteo de pendientes)       | `modelo-salas-citas.integration.test.ts`, `salas.schemas.test.ts`                                                         |
| CA-4.3-02 (rejilla de 20 bloques)                               | `apps/api/test/citas.modelo.test.ts`, `citas/validation.test.ts`                                                          |
| CA-5.1-01 (folio y estado Pendiente)                            | `modelo-salas-citas.integration.test.ts`                                                                                  |
| CA-5.1-04 (tres empalmes, contiguas y doble reserva simultánea) | `modelo-salas-citas.integration.test.ts`, `citas.modelo.test.ts`                                                          |
| CA-2.3-03, CA-5.1-03 (recursos inactivos, ADR-21)               | `modelo-salas-citas.integration.test.ts`, `citas/validation.test.ts`                                                      |
| CA-5.3-02, CA-5.4-01, CA-5.4-02 (versión y cancelación)         | `modelo-salas-citas.integration.test.ts`                                                                                  |
| ADR-18 (Vencidas)                                               | `modelo-salas-citas.integration.test.ts`                                                                                  |

Las suites de integración comparten la base de pruebas y la vacían con `TRUNCATE`, por lo que desde esta tarea se ejecutan en serie (`fileParallelism` en `apps/api/vitest.config.ts`).

### Diferencias entre PG-DSN-003 y la maqueta PG-DSN-003-INT

| Tema                         | PG-DSN-003 v0.1.0                         | Maqueta v0.1.0                        | Implementación                                                                                          |
| ---------------------------- | ----------------------------------------- | ------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Formato del folio            | `C26000001` (9 caracteres, ADR-17)        | `C-2026-00118` (12 caracteres)        | Se sigue ADR-17: el ERS 3.4 fija `VARCHAR(10)` y la maqueta no cabe. Conviene actualizar la maqueta.    |
| Estatus Vencida al modificar | Lo fija el sistema (ADR-18, H3-04)        | Se puede elegir en el formulario      | Se sigue ADR-18: la modificación no acepta `estado`.                                                    |
| Domingos                     | Sin regla                                 | «La clínica no atiende en domingo»    | Regla solo en el cliente, tomada de la maqueta; la base y la API no la imponen. Por confirmar (TP3-02). |
| Mensajes del nombre de sala  | «Escribe un nombre de 1 a 10 caracteres.» | Mensajes distintos para vacío y largo | El servidor usa el catálogo de 5.6 y el cliente los textos de la maqueta.                               |
