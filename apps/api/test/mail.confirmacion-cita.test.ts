import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * EDT 5.3.6. Verifica que la confirmación de cita (RF 5.1.14-5.1.15, CA-5.1-05, ADR-22) lleva el
 * folio tal como lo guarda la base, sin reformatearlo, y que el correo no copia datos personales
 * fuera de los que exige el RF (PG-DSN-003 4.6). Sin SMTP real: nodemailer se mockea antes de
 * importar mail.ts, para que transporter.sendMail nunca intente una conexión de red.
 */

const sendMail = vi.fn();

vi.mock('nodemailer', () => ({
  default: {
    createTransport: () => ({ sendMail }),
  },
}));

const { mailService } = await import('../src/modules/auth/mail.js');

afterEach(() => {
  sendMail.mockReset();
});

const FOLIO = 'C26000118';

const entrada = {
  correoPaciente: 'valeria.ku@example.com',
  nombrePaciente: 'Valeria Ku Escalante',
  nombreTerapeuta: 'Victoria Méndez Rosado',
  nombreSala: 'Sala A',
  folio: FOLIO,
  inicio: new Date('2026-10-26T15:00:00Z'),
};

describe('mailService.sendConfirmacionCita (EDT 5.3.6)', () => {
  it('el correo incluye el folio exactamente como lo guarda la base, sin reformatearlo (RF 5.1.14, CA-5.1-05)', async () => {
    sendMail.mockResolvedValue(undefined);

    await mailService.sendConfirmacionCita(entrada);

    expect(sendMail).toHaveBeenCalledTimes(1);
    const enviado = sendMail.mock.calls[0][0] as { text: string };
    expect(enviado.text).toContain('Folio: C26000118');
  });

  it('el correo incluye los cinco datos que exige RF 5.1.14: paciente, fecha y hora en la zona de la clínica, folio, terapeuta y sala', async () => {
    sendMail.mockResolvedValue(undefined);

    await mailService.sendConfirmacionCita(entrada);

    const enviado = sendMail.mock.calls[0][0] as { text: string };
    expect(enviado.text).toContain('Valeria Ku Escalante');
    // 2026-10-26T15:00:00Z es las 09:00 en America/Merida (CLINIC_TIME_ZONE).
    expect(enviado.text).toMatch(/9:00|09:00/);
    expect(enviado.text).toContain('26 de octubre de 2026');
    expect(enviado.text).toContain('Folio: C26000118');
    expect(enviado.text).toContain('Victoria Méndez Rosado');
    expect(enviado.text).toContain('Sala A');
  });

  it('el correo no incluye CURP ni teléfono del paciente (PG-DSN-003 4.6)', async () => {
    sendMail.mockResolvedValue(undefined);

    await mailService.sendConfirmacionCita(entrada);

    const enviado = sendMail.mock.calls[0][0] as { text: string };
    expect(enviado.text).not.toMatch(/curp/i);
    expect(enviado.text).not.toMatch(/\btel[eé]fono\b/i);
    expect(enviado.text).not.toMatch(/9996402218/);
  });

  it('un paciente sin correo registrado omite el envío y no llama a sendMail (RF 5.1.15)', async () => {
    const resultado = await mailService.sendConfirmacionCita({ ...entrada, correoPaciente: null });

    expect(resultado).toEqual({ enviada: false, motivo: 'sin_correo' });
    expect(sendMail).not.toHaveBeenCalled();
  });

  it('un fallo del servidor SMTP se devuelve como resultado, sin lanzar una excepción (ADR-22)', async () => {
    sendMail.mockRejectedValue(new Error('ECONNREFUSED'));

    const resultado = await mailService.sendConfirmacionCita(entrada);

    expect(resultado).toEqual({ enviada: false, motivo: 'fallo_envio' });
  });
});
