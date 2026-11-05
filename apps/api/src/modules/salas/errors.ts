import { AppError } from '../../platform/errors.js';
import { SALA_MENSAJES } from './schemas.js';

type DatabaseError = Error & { code?: string; constraint?: string };

/**
 * EDT 5.2.1. Traduce las violaciones de las restricciones de la tabla sala a los códigos de
 * PG-DSN-003 5.7.1. Devuelve null si el error no proviene de una de ellas, para que el llamador
 * lo propague sin cambios.
 */
export function salaDatabaseError(error: unknown): AppError | null {
  const databaseError = error as DatabaseError;
  if (databaseError?.code === '23505' && databaseError.constraint === 'uq_sala_nombre') {
    return new AppError(409, 'NOMBRE_SALA_EN_USO', SALA_MENSAJES.NOMBRE_SALA_EN_USO, {
      nombre: SALA_MENSAJES.NOMBRE_SALA_EN_USO,
    });
  }
  if (databaseError?.code === '23514' && databaseError.constraint === 'sala_nombre_no_vacio') {
    return new AppError(
      400,
      'VALIDACION_INVALIDA',
      'Revisa los datos marcados e inténtalo de nuevo.',
      { nombre: SALA_MENSAJES.NOMBRE_INVALIDO },
    );
  }
  // 22001: el nombre excede varchar(10). El esquema lo impide antes, pero la base es la garantía.
  if (databaseError?.code === '22001') {
    return new AppError(
      400,
      'VALIDACION_INVALIDA',
      'Revisa los datos marcados e inténtalo de nuevo.',
      { nombre: SALA_MENSAJES.NOMBRE_INVALIDO },
    );
  }
  return null;
}
