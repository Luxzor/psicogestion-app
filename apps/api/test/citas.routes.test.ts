import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { tokenService } from '../src/modules/auth/tokens.js';

/**
 * EDT 5.3.3. Rutas de citas que no necesitan Postgres ni Redis: validación de esquema y de
 * sesión, igual que pacientes.routes.test.ts y terapeutas.routes.test.ts. Todo lo que depende de
 * datos reales (códigos de §5.7.1 ligados a recursos, idempotencia, auditoría, correo, filtros
 * del listado contra datos, detalle) está en citas.integration.test.ts.
 */
const token = tokenService.createAccessToken({ id: randomUUID(), rol: 'administrador' });

const cuerpoValido = () => ({
  id_paciente: randomUUID(),
  id_terapeuta: randomUUID(),
  id_sala: randomUUID(),
  inicio: '2026-10-26T15:00:00Z',
  duracion_bloques: 2,
});

describe('rutas de citas sin dependencias externas', () => {
  it('rechaza el alta sin una sesión activa (401 SESION_INVALIDA)', async () => {
    const response = await request(createApp()).post('/api/v1/citas').send(cuerpoValido());

    expect(response.status).toBe(401);
    expect(response.body.codigo).toBe('SESION_INVALIDA');
  });

  it('rechaza el listado y el detalle sin una sesión activa', async () => {
    const lista = await request(createApp()).get('/api/v1/citas');
    expect(lista.status).toBe(401);
    expect(lista.body.codigo).toBe('SESION_INVALIDA');

    const detalle = await request(createApp()).get(`/api/v1/citas/${randomUUID()}`);
    expect(detalle.status).toBe(401);
  });

  it('rechaza un access token inválido', async () => {
    const response = await request(createApp())
      .get('/api/v1/citas')
      .set('Authorization', 'Bearer token-invalido');

    expect(response.status).toBe(401);
  });

  describe('alta de citas (RF 5.1.1-5.1.15)', () => {
    const post = (body: unknown) =>
      request(createApp())
        .post('/api/v1/citas')
        .set('Authorization', `Bearer ${token}`)
        .send(body as object);

    it('marca cada campo obligatorio faltante con su mensaje', async () => {
      const response = await post({});
      expect(response.status).toBe(400);
      expect(response.body.codigo).toBe('VALIDACION_INVALIDA');
      expect(response.body.campos).toMatchObject({
        id_paciente: 'Selecciona un paciente.',
        id_terapeuta: 'Selecciona un terapeuta.',
        id_sala: 'Elige una sala.',
        inicio: 'Elige la fecha y la hora de inicio.',
        duracion_bloques: 'Elige la duración de la cita.',
      });
    });

    it('rechaza un cuerpo con "estado": el cliente no lo envía (RF 5.1.5)', async () => {
      const response = await post({ ...cuerpoValido(), estado: 'Pendiente' });
      expect(response.status).toBe(400);
      expect(response.body.codigo).toBe('VALIDACION_INVALIDA');
    });

    it('rechaza un cuerpo con un campo desconocido', async () => {
      const response = await post({ ...cuerpoValido(), observaciones: 'texto libre' });
      expect(response.status).toBe(400);
    });

    it('rechaza una duración fuera de 1 a 4 bloques', async () => {
      for (const duracion_bloques of [0, 5, 1.5]) {
        const response = await post({ ...cuerpoValido(), duracion_bloques });
        expect(response.status).toBe(400);
      }
    });

    it('rechaza una llave de idempotencia con formato inválido', async () => {
      const response = await request(createApp())
        .post('/api/v1/citas')
        .set('Authorization', `Bearer ${token}`)
        .set('Idempotency-Key', 'no válida')
        .send(cuerpoValido());

      expect(response.status).toBe(400);
      expect(response.body.codigo).toBe('IDEMPOTENCY_KEY_INVALIDA');
    });
  });

  describe('listado de citas (RF 5.2.1-5.2.3, RNF 5.1.4)', () => {
    const get = (query: string) =>
      request(createApp()).get(`/api/v1/citas${query}`).set('Authorization', `Bearer ${token}`);

    it('rechaza un estado fuera del catálogo', async () => {
      const response = await get('?estado=Confirmada');
      expect(response.status).toBe(400);
      expect(response.body.codigo).toBe('VALIDACION_INVALIDA');
    });

    it('rechaza un id_sala que no es UUID', async () => {
      expect((await get('?id_sala=no-es-un-uuid')).status).toBe(400);
    });

    it('rechaza "desde" posterior a "hasta"', async () => {
      const response = await get('?desde=2026-11-01&hasta=2026-10-01');
      expect(response.status).toBe(400);
      expect(response.body.campos.desde).toBeDefined();
    });

    it('rechaza un folio con formato inválido', async () => {
      const response = await get('?folio=C-2026-00118');
      expect(response.status).toBe(400);
    });

    it('rechaza un tamaño de página mayor a 100 o igual a 0', async () => {
      expect((await get('?tamano=101')).status).toBe(400);
      expect((await get('?tamano=0')).status).toBe(400);
    });

    it('rechaza un parámetro de consulta desconocido', async () => {
      expect((await get('?paciente=' + randomUUID())).status).toBe(400);
    });
  });

  describe('detalle de cita (RF 5.2)', () => {
    it('valida el identificador antes de consultar', async () => {
      const response = await request(createApp())
        .get('/api/v1/citas/no-es-un-uuid')
        .set('Authorization', `Bearer ${token}`);

      expect(response.status).toBe(400);
      expect(response.body.codigo).toBe('VALIDACION_INVALIDA');
    });
  });
});
