# Trazabilidad ERS — Administración de cuentas

Esta implementación cubre el alcance de la Iteración 1 indicado por PG-DSN-001 y los requisitos de cuentas de PG-ERS-001 v0.3.

| ERS               | Implementación                                                                                                                                                   |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| RF 1.1.1–1.1.18   | Pantalla y endpoint de registro; correo UADY, nombre máximo de 50, teléfono único de 10 dígitos, consentimiento, contraseña confirmada y código de seis dígitos. |
| RF 1.2.1–1.2.5    | Inicio con correo institucional o teléfono y contraseña.                                                                                                         |
| RF 1.3.1–1.3.6    | Acción disponible en inicio autenticado, diálogo de confirmación, revocación de sesión y redirección al login.                                                   |
| RF 1.4.1–1.4.5    | Solicitud por correo institucional, enlace de un solo uso y pantalla de restablecimiento.                                                                        |
| RNF 1.1.1 / 1.2.2 | Errores en español, anunciados con `aria-live`; credenciales inválidas usan un mensaje único.                                                                    |
| RNF 1.3.3         | Access token solo en memoria; refresh token HttpOnly, Secure y SameSite; logout lo revoca.                                                                       |
| RNF 1.4.1–1.4.4   | Mailpit/SMTP, enlace de 10 minutos, respuesta neutral y Argon2id al cambiar contraseña.                                                                          |
| ERS 3.7.3         | TLS local, Argon2id, validación del servidor, rate limiting sin PII en claves Redis, bitácora sin secretos y enlaces de recuperación de un solo uso.             |

## Evidencia de calidad

| Requisito / riesgo                | Casos automatizados                                                            | Evidencia complementaria                                                  |
| --------------------------------- | ------------------------------------------------------------------------------ | ------------------------------------------------------------------------- |
| Registro y política de contraseña | `apps/api/test/auth.schemas.test.ts`, `apps/api/test/auth.integration.test.ts` | Reporte de cobertura de Vitest y resultado de CI.                         |
| Errores controlados               | `apps/api/test/health.test.ts`                                                 | Respuesta con `correlation_id` y contrato OpenAPI.                        |
| Recuperación de contraseña        | `apps/api/test/auth.integration.test.ts`                                       | Token selector + secreto, consumo transaccional y revocación de sesiones. |
| Autenticación, refresh y logout   | Pendiente de ampliar en pruebas de integración                                 | Debe completarse antes de FCA de Iteración 1.                             |

Los módulos de terapeutas, pacientes, salas, citas y agenda están fuera de la Iteración 1 conforme al documento de diseño y no se presentan como implementados.
