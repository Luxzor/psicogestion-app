import nodemailer from 'nodemailer';
import { env } from '../../config/env.js';

const transporter = nodemailer.createTransport({
  host: env.SMTP_HOST,
  port: env.SMTP_PORT,
  secure: false,
});

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
};
