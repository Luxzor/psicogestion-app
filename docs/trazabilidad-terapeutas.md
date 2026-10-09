# Trazabilidad ERS. Registro de terapeutas

Esta implementación cubre la actividad 4.3.4 del cronograma (PG-CRN-001 v0.2.0), con los requisitos de PG-ERS-001 v0.6.1 (sección 3.3.1), los criterios de aceptación de PG-PLI-002 v0.1.2 (sección 4.1.1) y el diseño visual y arquitectónico de PG-DSN-002 v0.1.3 / PG-DSN-002-INT v0.1.0 (pantalla Registro de terapeuta, ruta `/terapeutas/nuevo`).

| ERS                   | Implementación                                                                                                                                                                              |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| RF 2.1.1, RF 2.1.10   | Pantalla `/inicio/terapeutas/nuevo` y endpoint `POST /api/v1/terapeutas`; el terapeuta queda registrado y activo en el sistema.                                                             |
| RF 2.1.2, RF 2.1.3    | Nombre completo obligatorio, máximo 50 caracteres, con contador visible. Validado en cliente, servidor y base de datos (`varchar(50)`).                                                     |
| RF 2.1.4, RF 2.1.5    | Teléfono obligatorio de exactamente 10 dígitos y único en la tabla `terapeuta` (`uq_terapeuta_telefono`), con verificación anticipada tras 400 ms (`POST /api/v1/terapeutas/validaciones`). |
| RF 2.1.6, RF 2.1.7    | Correo electrónico obligatorio, con formato válido y único (`uq_terapeuta_correo` en minúsculas), con verificación anticipada.                                                              |
| RF 2.1.8, RF 2.1.9    | Fecha capturada como dd/mm/aaaa, validada estrictamente en calendario gregoriano y verificando que sea anterior a la fecha actual (`CLINIC_TIME_ZONE`).                                     |
| RF 2.1.11             | Carga de foto de perfil opcional; se permite guardar al terapeuta sin fotografía.                                                                                                           |
| RF 2.1.12, RF 2.1.13  | Fotografía validada en cliente y servidor: mínimo 200 x 200 px, peso máximo 5 MB, formatos JPEG o PNG exclusivamente. Se rechazan imágenes menores, corruptas o formatos inválidos.         |
| RF 2.1.14, RF 2.1.15  | Cédula profesional obligatoria de 7 u 8 dígitos numéricos (Decisión TP2-05), única en el sistema (`uq_terapeuta_cedula`), con verificación anticipada.                                      |
| RNF 2.1.1             | Mensajes claros en español junto a cada campo con `aria-describedby` y `role="alert"`; resumen de errores al enviar y foco en el primer campo inválido.                                     |
| RNF 2.1.2 a RNF 2.1.5 | Validación de formato en el cliente; verificación anticipada en menos de 2 segundos; respuesta en un solo viaje de red.                                                                     |
| RNF 2.1.6, CA-2.1-09  | Ante falla de red el formulario conserva todos los datos capturados y permite reintentar con la misma `Idempotency-Key` (ADR-13), sin crear registros parciales ni duplicados.              |
| RNF 2.1.7, R01        | Endpoints protegidos con access token (Bearer); la respuesta a duplicados (409) no expone datos de otros registros; bitácora de auditoría registra eventos sin datos sensibles.             |

## Comportamientos adicionales y diseño (PG-DSN-002)

| Aspecto de diseño                      | Implementación                                                                                                                                                                                                |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Guardado en dos pasos (Sección 5.8)    | Se guarda primero el terapeuta (`POST /api/v1/terapeutas`) y, si hay foto seleccionada, se envía (`PUT /api/v1/terapeutas/{id}/foto`). Si la foto falla, se ofrece "Reintentar" o "Continuar sin fotografía". |
| Inspección fail-fast de imagen         | Inspección rápida de dimensiones y cabeceras binarias (JPEG/PNG) sin dependencias nativas externas, fallando rápido con 413, 415 o 422 antes de escribir en disco o base de datos.                            |
| Cédula profesional (Decisión TP2-05)   | Obligatoria, solo dígitos numéricos de longitud 7 u 8 (`^[0-9]{7,8}$`).                                                                                                                                       |
| Unicidad de teléfono (Decisión TP2-04) | Restricción `UNIQUE` en la tabla `terapeuta` independiente de usuarios o pacientes.                                                                                                                           |
| Cambios sin guardar                    | El botón Cancelar y el enlace "Terapeutas" solicitan confirmación si el formulario está modificado; se bloquea el cierre de pestaña y cierre de sesión (`UnsavedChangesContext`).                             |
| Responsividad y estilos                | Pantalla con diseño adaptativo, barra de avance de carga de foto y tokens de diseño Satoshi de la Iteración 2.                                                                                                |

## Evidencia de calidad

| Requisito / criterio             | Casos automatizados                                                                                               |
| -------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| CA-2.1-01, CA-2.1-06             | `apps/api/test/terapeutas.integration.test.ts`, `RegistroTerapeutaPage.test.tsx`                                  |
| CA-2.1-02, CA-2.1-07, CA-2.1-08  | `apps/api/test/terapeutas.schemas.test.ts`, `apps/api/test/terapeutas.routes.test.ts`, `validation.test.ts`       |
| CA-2.1-03 y RNF 2.1.4            | `apps/api/test/terapeutas.integration.test.ts`, `RegistroTerapeutaPage.test.tsx`                                  |
| CA-2.1-04 (fecha anterior a hoy) | `terapeutas.schemas.test.ts`, `terapeutas.integration.test.ts`, `validation.test.ts`                              |
| CA-2.1-05 (foto dimensiones/MB)  | `terapeutas.schemas.test.ts`, `terapeutas.routes.test.ts`, `terapeutas.integration.test.ts`, `validation.test.ts` |
| CA-2.1-09 (idempotencia y red)   | `terapeutas.integration.test.ts`, `RegistroTerapeutaPage.test.tsx`                                                |
| CA-2.1-10 (formato correo)       | `terapeutas.schemas.test.ts`, `validation.test.ts`                                                                |

## Fuera del alcance de 4.3.4

La consulta, perfil y edición de terapeutas corresponden a la actividad 4.3.5; la baja lógica a la 4.3.6. Al registrar exitosamente, la aplicación redirige a `/inicio/terapeutas` mostrando el aviso de confirmación.
