import nodemailer from 'nodemailer';
import { env } from '../../config/env.js';
import { logger } from '../../platform/logger.js';

const transporter = nodemailer.createTransport({
  host: env.SMTP_HOST,
  port: env.SMTP_PORT,
  secure: false,
});

/** Fecha y hora en la zona de la clínica, para el correo de confirmación (RF 5.1.14). */
const fechaHoraFormatter = new Intl.DateTimeFormat('es-MX', {
  timeZone: env.CLINIC_TIME_ZONE,
  dateStyle: 'long',
  timeStyle: 'short',
});

/** Oculta el correo para mostrarlo en pantalla (PG-DSN-003 5.4): j***@dominio.com. */
export function maskEmail(correo: string) {
  const [local, domain] = correo.split('@');
  if (!domain) return '***';
  return `${local.slice(0, 1) || '*'}***@${domain}`;
}

export type CitaConfirmacionInput = {
  /** null u omitido si el paciente no tiene correo registrado (RF 5.1.15). */
  correoPaciente?: string | null;
  nombrePaciente: string;
  nombreTerapeuta: string;
  nombreSala: string;
  folio: string;
  inicio: Date;
};

/** Resultado del envío (ADR-22): nunca lanza, para no bloquear el alta de la cita. */
export type CitaConfirmacion =
  { enviada: true; destino: string } | { enviada: false; motivo: 'sin_correo' | 'fallo_envio' };

export const mailService = {
  sendVerificationCode(to: string, code: string) {
    return transporter.sendMail({
      from: env.SMTP_FROM,
      to,
      subject: 'PsicoGestión: verifica tu correo',
      text: `Tu código de verificación es ${code}. Vence en ${env.VERIFICATION_CODE_TTL_MINUTES} minutos.`,
    });
  },

  sendRecoveryLink(to: string, token: string) {
    const link = `${env.WEB_ORIGIN}/restablecer?token=${encodeURIComponent(token)}`;
    return transporter.sendMail({
      from: env.SMTP_FROM,
      to,
      subject: 'PsicoGestión: restablece tu contraseña',
      text: `Solicitaste restablecer tu contraseña. Usa este enlace una sola vez dentro de ${env.RECOVERY_TOKEN_TTL_MINUTES} minutos: ${link}`,
    });
  },

  /**
   * RF 5.1.14–5.1.15 (EDT 5.3.3). Confirmación de cita al paciente: su nombre, fecha y hora en
   * CLINIC_TIME_ZONE, folio, terapeuta y sala; sin CURP, teléfono ni datos clínicos (R01). Se
   * envía después de confirmar la transacción del alta y no debe bloquearla (ADR-22): por eso
   * nunca lanza, y un correo ausente o un fallo del servidor SMTP se devuelven como resultado en
   * lugar de una excepción. No formatea el folio: solo muestra el valor que recibe.
   *
   * NOTA PARA EDT 5.3.6 (generación de folios)
   * - El folio se genera en la base: el DEFAULT de cita.folio y la secuencia cita_folio_seq
   *   (db/migrations/0009_sala_cita.sql).
   * - Se lee con RETURNING folio en citaRepository.create (apps/api/src/modules/citas/repository.ts).
   * - Un alta fallida (por ejemplo por empalme) consume un número de la secuencia y deja un hueco;
   *   es el comportamiento esperado (PG-DSN-003 11.3).
   * - El año del folio sale de America/Merida (CLINIC_TIME_ZONE), no de UTC.
   * - El folio no se reutiliza, ni siquiera el de una cita cancelada.
   * - Este correo es uno de los lugares donde se consume el folio; los otros son la respuesta del
   *   alta (POST /citas), la pantalla de éxito de "Agendar cita" y la búsqueda por folio del
   *   listado de citas (GET /citas?folio=).
   * - La prueba que verifica RNF 5.1.2 (folio en menos de 2 s) es la de integración del alta de
   *   citas en apps/api/test (modelo-salas-citas.integration.test.ts y la que agregue la EDT 5.3.3).
   */
  async sendConfirmacionCita(input: CitaConfirmacionInput): Promise<CitaConfirmacion> {
    const correo = input.correoPaciente;
    if (!correo) return { enviada: false, motivo: 'sin_correo' };

    try {
      await transporter.sendMail({
        from: env.SMTP_FROM,
        to: correo,
        subject: 'PsicoGestión: confirmación de tu cita',
        text: [
          `Hola ${input.nombrePaciente}, tu cita quedó agendada.`,
          `Folio: ${input.folio}`,
          `Fecha y hora: ${fechaHoraFormatter.format(input.inicio)}`,
          `Terapeuta: ${input.nombreTerapeuta}`,
          `Sala: ${input.nombreSala}`,
        ].join('\n'),
      });
      return { enviada: true, destino: maskEmail(correo) };
    } catch (error) {
      logger.warn(
        { err: error, folio: input.folio },
        'No se pudo enviar la confirmación de la cita',
      );
      return { enviada: false, motivo: 'fallo_envio' };
    }
  },
};
