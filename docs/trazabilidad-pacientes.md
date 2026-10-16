# Trazabilidad ERS. Administración de pacientes

## Registro de pacientes (EDT 4.3.1)

Esta implementación cubre la actividad 4.3.1 del cronograma (PG-CRN-001 v0.2.0), con los requisitos de PG-ERS-001 v0.6.1, los criterios de aceptación de PG-PLI-002 v0.1.2 y el diseño de interfaces PG-DSN-002-INT v0.1.0 (pantalla Registro de paciente, ruta `/pacientes/nuevo`).

| ERS                   | Implementación                                                                                                                                                         |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| RF 3.1.1, RF 3.1.12   | Pantalla `/inicio/pacientes/nuevo` y endpoint `POST /api/v1/pacientes`; el paciente queda registrado y activo.                                                         |
| RF 3.1.2, RF 3.1.3    | Nombre completo obligatorio, máximo 50 caracteres, con contador visible. Validado en el cliente, en el servidor y en la base de datos (`varchar(50)`).                 |
| RF 3.1.4, RF 3.1.5    | CURP obligatorio, validado por estructura (expresión de 18 caracteres) y único (`paciente_curp_unico`). Unicidad anticipada con `POST /api/v1/pacientes/validaciones`. |
| RF 3.1.6              | Sexo obligatorio: Femenino, Masculino u Otro (`F`, `M`, `O`).                                                                                                          |
| RF 3.1.7 a RF 3.1.9   | Fecha capturada como dd/mm/aaaa, anterior a la fecha de registro y con al menos 7 años cumplidos, calculados en la zona horaria de la clínica (`CLINIC_TIME_ZONE`).    |
| RF 3.1.10, RF 3.1.11  | Teléfono obligatorio de exactamente 10 dígitos y único (`paciente_telefono_unico`), con verificación anticipada.                                                       |
| RF 3.1.13, RF 3.1.14  | Correo electrónico opcional; si se captura, se valida su formato y se guarda en minúsculas.                                                                            |
| RNF 3.1.1             | Mensajes en español junto a cada campo, asociados con `aria-describedby` y anunciados con `role="alert"`; resumen de errores al enviar y foco en el primer campo.      |
| RNF 3.1.2 a RNF 3.1.4 | Validación de formato en el cliente al salir de cada campo; unicidad anticipada tras 400 ms sin escribir; respuesta del servidor en un solo viaje.                     |
| RNF 3.1.5             | La fecha completa se valida de inmediato, sin esperar a salir del campo.                                                                                               |
| RNF 3.2.6             | Ante una falla de red el formulario conserva lo capturado y ofrece Reintentar con la misma `Idempotency-Key` (ADR-13), sin duplicar el registro.                       |
| RNF 3.2.7, R01        | Endpoints protegidos con access token; la respuesta de duplicado no expone datos de otros pacientes; la bitácora guarda solo el identificador del paciente.            |

### Comportamientos adicionales del diseño

| PG-DSN-002-INT                   | Implementación                                                                                                                                              |
| -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| CURP de un paciente dado de baja | El servidor responde `409 PACIENTE_DADO_DE_BAJA`; la interfaz ofrece reactivar el perfil con los datos capturados (`POST /pacientes/{id}/reactivacion`).    |
| Cambios sin guardar              | Cancelar y la liga de regreso piden confirmación; el cierre de sesión se bloquea mediante `UnsavedChangesContext`; el navegador avisa al cerrar la pestaña. |
| Consentimiento                   | Casilla opcional; se guarda `consentimiento` y la fecha `consentimiento_en`.                                                                                |
| Modo oscuro y tablet             | Tokens de la Iteración 2 en `styles.css`; el formulario pasa a una columna en pantallas angostas.                                                           |

### Evidencia de calidad

| Requisito / criterio                   | Casos automatizados                                                                                       |
| -------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| CA-3.1-01, CA-3.1-07                   | `apps/api/test/pacientes.integration.test.ts`, `RegistroPacientePage.test.tsx`                            |
| CA-3.1-02, CA-3.1-05, CA-3.1-08        | `apps/api/test/pacientes.schemas.test.ts`, `apps/api/test/pacientes.routes.test.ts`, `validation.test.ts` |
| CA-3.1-03 y RNF 3.1.3                  | `apps/api/test/pacientes.integration.test.ts` (duplicados y verificación en menos de 2 segundos)          |
| CA-3.1-04 (7 años exactos, menor, hoy) | `pacientes.schemas.test.ts`, `pacientes.integration.test.ts`, `validation.test.ts`                        |
| Idempotencia y reactivación            | `pacientes.integration.test.ts`, `RegistroPacientePage.test.tsx`                                          |
| Sesión obligatoria (CA-3.2-05)         | `pacientes.routes.test.ts`                                                                                |

### Fuera del alcance de 4.3.1

La baja lógica y la reactivación de un paciente desde su propio perfil corresponden a la actividad 4.3.3. Desde la EDT 4.3.2, al guardar un alta exitosa la pantalla redirige al perfil del paciente creado (`/inicio/pacientes/{id}`, PG-DSN-002 §5.5) en lugar de volver a la lista.

## Consulta y edición de pacientes (EDT 4.3.2)

Esta implementación cubre la actividad 4.3.2 del cronograma (PG-CRN-001 v0.2.0), con los requisitos de PG-ERS-001 v0.6.3 (RF 3.2.1 a RF 3.2.6, RNF 3.2.1 a RNF 3.2.7), los criterios de aceptación de PG-PLI-002 v0.1.3 (CA-3.2-01 a CA-3.2-06, sección 4.1.4) y el diseño de PG-DSN-002 v0.1.3 (secciones 5.4, 5.6 y 5.12.3; ADR-10, ADR-12 y ADR-14) y PG-DSN-002-INT v0.1.0 (pantallas Lista de pacientes `/pacientes`, Perfil `/pacientes/:id` y Edición `/pacientes/:id/editar`).

| ERS       | Implementación                                                                                                                                                                                                                      |
| --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| RF 3.2.1  | Pantalla `/inicio/pacientes` y endpoint `GET /api/v1/pacientes`: listado paginado (25 por página, máximo 100) de solo pacientes activos, con `count(*) OVER()` en la misma consulta para el total.                                  |
| RF 3.2.2  | Pantalla `/inicio/pacientes/:id` (`GET /api/v1/pacientes/{id}`) para ver el perfil y pantalla `/inicio/pacientes/:id/editar` (`PATCH /api/v1/pacientes/{id}`) para actualizarlo.                                                    |
| RF 3.2.3  | Vista "Nombre Paciente": nombre completo, fecha de nacimiento con edad calculada en el servidor, CURP, sexo, teléfono y correo electrónico (`No registrado` si falta).                                                              |
| RF 3.2.4  | Botón "Editar" en el perfil; el formulario de edición reutiliza los campos del registro (`PatientFormFields`, `usePatientForm`) prellenados y permite modificar solo algunos.                                                       |
| RF 3.2.5  | Verificación de unicidad de CURP y teléfono al editar, excluyendo al propio paciente (`excluir_id` en `POST /api/v1/pacientes/validaciones` y en el repositorio).                                                                   |
| RF 3.2.6  | Botón "Guardar cambios", habilitado solo si hay diferencias; el `PATCH` envía únicamente los campos modificados más la `version` leída (ADR-10).                                                                                    |
| RNF 3.2.1 | Índice `(activo, nombre_completo COLLATE es_mx_icu)` y búsqueda por `f_sin_acentos(lower(nombre_completo))` con `pg_trgm` (`db/migrations/0007_paciente_busqueda.sql`); la lista responde en milisegundos con cientos de registros. |
| RNF 3.2.2 | Edición parcial: el cuerpo del `PATCH` solo lleva los campos que cambiaron (`diffPayload`); el resto del perfil se conserva sin volver a capturarse.                                                                                |
| RNF 3.2.3 | La validación de formato y de unicidad se completa antes de guardar, en una sola transacción del lado del servidor.                                                                                                                 |
| RNF 3.2.4 | Un conflicto de unicidad (409 `CURP_EN_USO` o `TELEFONO_EN_USO`, CURP antepuesto al teléfono) se muestra junto al campo correspondiente, sin guardar nada.                                                                          |
| RNF 3.2.5 | La respuesta del `PATCH` reemplaza el detalle en la caché de TanStack Query y se invalidan las listas (`useUpdatePatient`); el perfil y la lista reflejan el cambio sin recargar la página.                                         |
| RNF 3.2.6 | Ante una falla de red o un error del servidor al guardar, el formulario conserva lo capturado y ofrece "Reintentar" (CA-3.2-06).                                                                                                    |
| RNF 3.2.7 | Endpoints protegidos con sesión obligatoria (CA-3.2-05); la lista expone solo `id`, `nombre_completo`, `telefono`, `edad` y `activo` (minimización de datos, R01); el CURP y el correo solo aparecen en el perfil.                  |

### Comportamientos adicionales del diseño

| PG-DSN-002                                   | Implementación                                                                                                                                                                                                                                                                                                                                                |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Conflicto de versión (ADR-10)                | Si la `version` enviada ya no es la vigente, el servidor responde `409 CONFLICTO_VERSION` con `version_actual`; el cliente recarga el perfil y reaplica encima los campos capturados, señalando cuáles cambió también la otra persona. Si tras recargar ya no hay diferencias (la respuesta del primer intento se perdió), se trata como un guardado exitoso. |
| Unicidad anticipada al editar                | `POST /api/v1/pacientes/validaciones` acepta `excluir_id`, de modo que el propio paciente no se marca como un conflicto consigo mismo.                                                                                                                                                                                                                        |
| Auditoría sin datos personales (ADR-14)      | Cada apertura exitosa de un perfil se registra en `bitacora_acceso` como `paciente_consultado`; cada edición exitosa como `paciente_actualizado`, con el `detalle` limitado al id y a los **nombres** de los campos modificados (`id campos=telefono,correo`), nunca a sus valores.                                                                           |
| Edad mínima al editar la fecha de nacimiento | El límite de 7 años se mide contra la `fecha_registro` del paciente, no contra el día de la edición (PG-DSN-002 §4.5): un paciente registrado hace varios años conserva la edad que tenía al darse de alta como referencia.                                                                                                                                   |
| Caché de datos del servidor (ADR-12)         | `@tanstack/react-query` con `staleTime` de 30 s y sin reintentos automáticos (`src/lib/queryClient.ts`); las claves `['pacientes','lista',params]` y `['pacientes','detalle',id]` se usan para actualizar o invalidar.                                                                                                                                        |
| Redirección del alta al perfil (§5.5)        | Desde esta actividad, `RegistroPacientePage` redirige a `/inicio/pacientes/{id}` con el aviso "Paciente registrado" en lugar de volver a la lista.                                                                                                                                                                                                            |
| Estados de la lista (§5.4)                   | Esqueleto de carga, aviso de lista vacía, aviso de búsqueda sin resultados y error de carga con "Reintentar"; búsqueda con pausa de 300 ms y paginación con "Mostrando X–Y de N".                                                                                                                                                                             |
| Cambios sin guardar en la edición            | Igual que en el registro: Cancelar y la liga de regreso piden confirmación; el cierre de sesión se bloquea mediante `UnsavedChangesContext` mientras el formulario esté sucio.                                                                                                                                                                                |

### Evidencia de calidad

| Requisito / criterio                                         | Casos automatizados                                                                                                                                               |
| ------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| RF 3.2.1, RNF 3.2.1, RNF 3.2.7 (lista y minimización)        | `apps/api/test/pacientes.integration.test.ts`, `apps/api/test/pacientes.routes.test.ts`, `PacientesPage.test.tsx`                                                 |
| RF 3.2.2, RF 3.2.3 (perfil)                                  | `apps/api/test/pacientes.integration.test.ts` (auditoría `paciente_consultado` y 404), `PerfilPacientePage.test.tsx`                                              |
| RF 3.2.4 a RF 3.2.6, RNF 3.2.2 a RNF 3.2.4 (edición parcial) | `apps/api/test/pacientes.schemas.test.ts`, `apps/api/test/pacientes.routes.test.ts`, `apps/api/test/pacientes.integration.test.ts`, `EditarPacientePage.test.tsx` |
| RNF 3.2.5 (reflejo sin recargar)                             | `EditarPacientePage.test.tsx` (caché de TanStack Query actualizada tras el `PATCH`)                                                                               |
| RNF 3.2.6 (falla de red al guardar)                          | `EditarPacientePage.test.tsx`                                                                                                                                     |
| CA-3.2-05 (sesión obligatoria)                               | `apps/api/test/pacientes.routes.test.ts`                                                                                                                          |
| Conflicto de versión (ADR-10)                                | `apps/api/test/pacientes.integration.test.ts`, `EditarPacientePage.test.tsx` (incluye el caso sin diferencias restantes)                                          |
| Unicidad con `excluir_id` (RF 3.2.5)                         | `apps/api/test/pacientes.integration.test.ts`                                                                                                                     |

### Fuera del alcance de 4.3.2

La baja lógica, el filtro "Dados de baja" en el listado y la reactivación desde el perfil del paciente corresponden a la actividad 4.3.3, documentada en la sección siguiente.

## Baja lógica y reactivación de pacientes (EDT 4.3.3)

Esta implementación cubre la actividad 4.3.3 del cronograma (PG-CRN-001 v0.2.0), con los requisitos de baja de PG-ERS-001 (RF 3.3.1 a RF 3.3.3), los criterios de aceptación de PG-PLI-002 (CA-3.3-01 a CA-3.3-04) y el diseño de PG-DSN-002-INT v0.1.0 (pantallas Lista de pacientes `/pacientes` con el filtro "Mostrar: Activos o Dados de baja" y Perfil y baja del paciente `/pacientes/:id`). La reactivación por CURP desde el registro (CA-3.3-05) ya existía desde la EDT 4.3.1 y no cambia.

| ERS / diseño                    | Implementación                                                                                                                                                                                                                               |
| ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| RF 3.3.1 (baja lógica)          | `POST /api/v1/pacientes/{id}/baja`: un solo `UPDATE` que deja `activo = false` y `fecha_baja = now()`. El registro no se borra y ningún dato del perfil cambia; queda `updated_by` con quien hizo la baja.                                   |
| RF 3.3.2 (confirmación)         | Botón "Dar de baja" en el perfil de un paciente activo; abre un diálogo `role="alertdialog"` con el foco inicial en "Cancelar". Esc o "Cancelar" lo cierran sin enviar nada.                                                                 |
| RF 3.3.3 (efecto de la baja)    | El paciente sale de la lista de activos y aparece con la insignia "Dado de baja" en el filtro "Dados de baja" (`GET /api/v1/pacientes?estado=inactivos`). Su perfil sigue disponible, pero sin "Editar" ni "Dar de baja".                    |
| Reactivación desde el perfil    | Botón "Reactivar paciente" en un perfil dado de baja; `POST /api/v1/pacientes/{id}/reactivacion` sin cuerpo devuelve al paciente a la lista de activos con sus datos anteriores.                                                             |
| Edición de un paciente inactivo | Se mantiene la regla de la EDT 4.3.2: `PATCH` responde `409 PACIENTE_INACTIVO`; la pantalla de edición remite al perfil para reactivarlo.                                                                                                    |
| RNF 3.2.5 (reflejo inmediato)   | La respuesta de la baja o de la reactivación reemplaza el perfil en la caché de TanStack Query y se invalidan las listas (`useDischargePatient`, `useRestorePatient`).                                                                       |
| RNF 3.2.6 (falla de red)        | El diálogo se conserva abierto con el aviso "No pudimos dar de baja al paciente porque no hubo conexión con el servidor. El perfil no cambió. Intenta de nuevo." y el botón "Reintentar", que reutiliza la misma `Idempotency-Key` (ADR-13). |
| RNF 3.2.7, R01                  | Endpoints protegidos con sesión obligatoria; la lista de dados de baja conserva la minimización de datos (sin CURP ni correo).                                                                                                               |

### Comportamientos adicionales del diseño

| PG-DSN-002                              | Implementación                                                                                                                                                                                                                                                            |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Auditoría sin datos personales (ADR-14) | La baja se registra en `bitacora_acceso` como `paciente_dado_de_baja` con solo el id. La reactivación desde el perfil se registra como `paciente_reactivado` con el detalle `{id} datos=conservados`, para distinguirla de la reactivación con datos nuevos del registro. |
| Control de versión (ADR-10)             | La baja y la reactivación suben `version`; una edición abierta en otra pestaña antes de la baja recibe `409` y no se aplica.                                                                                                                                              |
| Idempotencia (ADR-13)                   | Ambas operaciones aceptan `Idempotency-Key`: si la respuesta se pierde, el reintento recibe la respuesta original en lugar de un `409` por un paciente que ya cambió de estado.                                                                                           |
| Estado ya cambiado por otra persona     | Dar de baja a un paciente ya inactivo responde `409 PACIENTE_INACTIVO` (con su `fecha_baja`) sin modificar la fecha original; reactivar a uno activo responde `409 PACIENTE_ACTIVO`. La interfaz cierra el diálogo, vuelve a leer el perfil y lo informa.                 |
| Fecha de la baja                        | `fecha_baja` se informa como el día de la zona horaria de la clínica (`CLINIC_TIME_ZONE`), no en UTC: una baja hecha después de las 18:00 en Mérida no aparece con la fecha del día siguiente.                                                                            |
| Filtro en la URL                        | El filtro "Dados de baja" se guarda como `?estado=inactivos`; al volver desde el perfil la lista conserva el filtro, y cambiarlo conserva la búsqueda y regresa a la primera página. Componente `StatusFilter` (TP2-06).                                                  |
| Cierre de sesión con acción pendiente   | Mientras la baja o la reactivación están en curso, `UnsavedChangesContext` bloquea el cierre de sesión (PG-DSN-002 §5.11).                                                                                                                                                |
| Énfasis destructivo                     | "Dar de baja" usa los estilos `button--danger-soft` y `button--danger`; el texto del botón dice la acción, de modo que no depende solo del color. Las insignias "Activo" y "Dado de baja" llevan texto e ícono.                                                           |

### Evidencia de calidad

| Requisito / criterio                                         | Casos automatizados                                                                                                                                          |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| RF 3.3.1 (baja que conserva datos y auditoría)               | `apps/api/test/pacientes.integration.test.ts`                                                                                                                |
| RF 3.3.2 (diálogo, foco en Cancelar, Esc sin cambios)        | `PerfilPacientePage.test.tsx`                                                                                                                                |
| RF 3.3.3 (lista de activos y de dados de baja, búsqueda)     | `apps/api/test/pacientes.integration.test.ts`, `apps/api/test/pacientes.schemas.test.ts`, `apps/api/test/pacientes.routes.test.ts`, `PacientesPage.test.tsx` |
| Reactivación desde el perfil                                 | `apps/api/test/pacientes.integration.test.ts`, `PerfilPacientePage.test.tsx`                                                                                 |
| Idempotencia y falla de red (ADR-13, RNF 3.2.6)              | `apps/api/test/pacientes.integration.test.ts`, `PerfilPacientePage.test.tsx` (misma llave al reintentar)                                                     |
| Estado ya cambiado, versión y fecha en la zona de la clínica | `apps/api/test/pacientes.integration.test.ts`                                                                                                                |
| Sesión obligatoria y cuerpo vacío estricto                   | `apps/api/test/pacientes.routes.test.ts`, `apps/api/test/pacientes.schemas.test.ts`                                                                          |

### Fuera del alcance de 4.3.3

La baja no tiene todavía efecto sobre citas ni asignaciones de terapeuta, porque esos módulos corresponden a la Iteración 3. Cuando existan, la baja deberá decidir qué ocurre con las citas futuras del paciente.
