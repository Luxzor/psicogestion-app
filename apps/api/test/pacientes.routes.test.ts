import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { tokenService } from '../src/modules/auth/tokens.js';

const token = tokenService.createAccessToken({ id: randomUUID(), rol: 'administrador' });

describe('rutas de pacientes sin dependencias externas', () => {
  it('rechaza el registro sin una sesión activa (CA-3.2-05)', async () => {
    const response = await request(createApp()).post('/api/v1/pacientes').send({});

    expect(response.status).toBe(401);
    expect(response.body.codigo).toBe('SESION_INVALIDA');
  });

  it('rechaza un access token inválido', async () => {
    const response = await request(createApp())
      .post('/api/v1/pacientes/validaciones')
      .set('Authorization', 'Bearer token-invalido')
      .send({ campo: 'curp', valor: 'KUEV090825MYNXSLA3' });

    expect(response.status).toBe(401);
  });

  it('devuelve los errores por campo cuando faltan datos obligatorios (RNF 3.1.1)', async () => {
    const response = await request(createApp())
      .post('/api/v1/pacientes')
      .set('Authorization', `Bearer ${token}`)
      .send({ nombre_completo: 'a'.repeat(51), telefono: '99945' });

    expect(response.status).toBe(400);
    expect(response.body.codigo).toBe('VALIDACION_INVALIDA');
    expect(response.body.campos).toMatchObject({
      nombre_completo: 'El nombre no puede tener más de 50 caracteres.',
      curp: expect.any(String),
      sexo: 'Selecciona el sexo.',
      fecha_nacimiento: expect.any(String),
      telefono: 'El teléfono debe tener exactamente 10 dígitos.',
    });
  });

  it('rechaza una llave de idempotencia con formato inválido', async () => {
    const response = await request(createApp())
      .post('/api/v1/pacientes')
      .set('Authorization', `Bearer ${token}`)
      .set('Idempotency-Key', 'no válida')
      .send({
        nombre_completo: 'Valeria Ku Escalante',
        curp: 'KUEV090825MYNXSLA3',
        sexo: 'F',
        fecha_nacimiento: '2009-08-25',
        telefono: '9996402218',
      });

    expect(response.status).toBe(400);
    expect(response.body.codigo).toBe('IDEMPOTENCY_KEY_INVALIDA');
  });

  it('valida el identificador antes de reactivar', async () => {
    const response = await request(createApp())
      .post('/api/v1/pacientes/123/reactivacion')
      .set('Authorization', `Bearer ${token}`)
      .send({});

    expect(response.status).toBe(400);
    expect(response.body.codigo).toBe('VALIDACION_INVALIDA');
  });
});
