# Trazabilidad ERS. Registro de pacientes

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

## Comportamientos adicionales del diseño

| PG-DSN-002-INT                   | Implementación                                                                                                                                              |
| -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| CURP de un paciente dado de baja | El servidor responde `409 PACIENTE_DADO_DE_BAJA`; la interfaz ofrece reactivar el perfil con los datos capturados (`POST /pacientes/{id}/reactivacion`).    |
| Cambios sin guardar              | Cancelar y la liga de regreso piden confirmación; el cierre de sesión se bloquea mediante `UnsavedChangesContext`; el navegador avisa al cerrar la pestaña. |
| Consentimiento                   | Casilla opcional; se guarda `consentimiento` y la fecha `consentimiento_en`.                                                                                |
| Modo oscuro y tablet             | Tokens de la Iteración 2 en `styles.css`; el formulario pasa a una columna en pantallas angostas.                                                           |

## Evidencia de calidad

| Requisito / criterio                   | Casos automatizados                                                                                       |
| -------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| CA-3.1-01, CA-3.1-07                   | `apps/api/test/pacientes.integration.test.ts`, `RegistroPacientePage.test.tsx`                            |
| CA-3.1-02, CA-3.1-05, CA-3.1-08        | `apps/api/test/pacientes.schemas.test.ts`, `apps/api/test/pacientes.routes.test.ts`, `validation.test.ts` |
| CA-3.1-03 y RNF 3.1.3                  | `apps/api/test/pacientes.integration.test.ts` (duplicados y verificación en menos de 2 segundos)          |
| CA-3.1-04 (7 años exactos, menor, hoy) | `pacientes.schemas.test.ts`, `pacientes.integration.test.ts`, `validation.test.ts`                        |
| Idempotencia y reactivación            | `pacientes.integration.test.ts`, `RegistroPacientePage.test.tsx`                                          |
| Sesión obligatoria (CA-3.2-05)         | `pacientes.routes.test.ts`                                                                                |

## Fuera del alcance de 4.3.1

La lista de pacientes con búsqueda y filtros, el perfil "Nombre Paciente" y la edición corresponden a la actividad 4.3.2; la baja lógica a la 4.3.3. Mientras tanto, al guardar se regresa a `/inicio/pacientes` con el aviso de confirmación.
