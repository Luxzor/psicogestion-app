import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { tokenService } from '../src/modules/auth/tokens.js';

/**
 * EDT 5.3.1, EDT 5.3.2 y rutas de edición/recuperación de salas. Rutas que no necesitan Postgres ni
 * Redis: sesión y validación de entrada, igual que citas.routes.test.ts. Lo que depende de datos
 * (unicidad, baja con citas pendientes, versión, idempotencia) está en salas.integration.test.ts.
 */
const token = tokenService.createAccessToken({ id: randomUUID(), rol: 'administrador' });
const auth = { Authorization: `Bearer ${token}` };

describe('rutas de salas sin dependencias externas', () => {
  describe('sesión', () => {
    const rutas: Array<[string, string, string]> = [
      ['get', '/api/v1/salas', 'listado'],
      ['get', '/api/v1/salas/disponibilidad?fecha=2027-03-01', 'disponibilidad'],
      [`get`, `/api/v1/salas/${randomUUID()}`, 'detalle'],
      ['get', `/api/v1/salas/${randomUUID()}/citas-pendientes`, 'citas pendientes'],
      ['post', '/api/v1/salas', 'alta'],
      ['post', '/api/v1/salas/validaciones', 'validación de nombre'],
      ['post', `/api/v1/salas/${randomUUID()}/baja`, 'baja'],
      ['patch', `/api/v1/salas/${randomUUID()}`, 'edición'],
      ['post', `/api/v1/salas/${randomUUID()}/reactivar`, 'reactivación'],
      ['post', `/api/v1/salas/${randomUUID()}/recuperar`, 'recuperación'],
    ];

    it.each(rutas)(
      '%s %s (%s) exige una sesión activa (401 SESION_INVALIDA)',
      async (metodo, ruta) => {
        const response = await (
          request(createApp()) as unknown as Record<string, (r: string) => request.Test>
        )
          [metodo](ruta)
          .send({});
        expect(response.status).toBe(401);
        expect(response.body.codigo).toBe('SESION_INVALIDA');
      },
    );

    it('rechaza un access token inválido', async () => {
      const response = await request(createApp())
        .get('/api/v1/salas')
        .set('Authorization', 'Bearer token-invalido');
      expect(response.status).toBe(401);
    });
  });

  describe('alta de sala (RF 4.1.1 a RF 4.1.4)', () => {
    const post = (body: unknown) =>
      request(createApp())
        .post('/api/v1/salas')
        .set(auth)
        .send(body as object);

    it('rechaza un nombre vacío o solo con espacios', async () => {
      for (const nombre of ['', '   ']) {
        const response = await post({ nombre });
        expect(response.status).toBe(400);
        expect(response.body.codigo).toBe('VALIDACION_INVALIDA');
        expect(response.body.campos.nombre).toBe('Escribe un nombre de 1 a 10 caracteres.');
      }
    });

    it('rechaza un nombre de más de 10 caracteres', async () => {
      const response = await post({ nombre: 'Sala de juegos' });
      expect(response.status).toBe(400);
      expect(response.body.campos.nombre).toBe('Escribe un nombre de 1 a 10 caracteres.');
    });

    it('rechaza un cuerpo sin nombre y los campos no previstos', async () => {
      expect((await post({})).status).toBe(400);
      expect((await post({ nombre: 'Sala A', extra: true })).status).toBe(400);
    });
  });

  describe('validación anticipada del nombre (RF 4.1.4, RNF 4.1.2)', () => {
    const post = (body: unknown) =>
      request(createApp())
        .post('/api/v1/salas/validaciones')
        .set(auth)
        .send(body as object);

    it('solo acepta el campo nombre', async () => {
      const response = await post({ campo: 'telefono', valor: 'Sala A' });
      expect(response.status).toBe(400);
      expect(response.body.codigo).toBe('VALIDACION_INVALIDA');
    });

    it('exige un valor de texto', async () => {
      expect((await post({ campo: 'nombre' })).status).toBe(400);
    });

    it('rechaza un excluir_id que no es UUID', async () => {
      expect((await post({ campo: 'nombre', valor: 'Sala A', excluir_id: '123' })).status).toBe(
        400,
      );
    });
  });

  describe('identificador de sala', () => {
    it.each([
      ['get', '/api/v1/salas/no-es-uuid'],
      ['get', '/api/v1/salas/no-es-uuid/citas-pendientes'],
      ['post', '/api/v1/salas/no-es-uuid/baja'],
      ['post', '/api/v1/salas/no-es-uuid/reactivar'],
      ['patch', '/api/v1/salas/no-es-uuid'],
    ])('%s %s responde 400 con el mensaje del identificador', async (metodo, ruta) => {
      const response = await (
        request(createApp()) as unknown as Record<string, (r: string) => request.Test>
      )
        [metodo](ruta)
        .set(auth)
        .send({ nombre: 'Sala A', version: 1 });
      expect(response.status).toBe(400);
      expect(response.body.codigo).toBe('VALIDACION_INVALIDA');
    });
  });

  describe('baja y reactivación (RF 4.2.1 a RF 4.2.5)', () => {
    it('la baja y la reactivación no reciben datos en el cuerpo', async () => {
      for (const ruta of ['baja', 'reactivar']) {
        const response = await request(createApp())
          .post(`/api/v1/salas/${randomUUID()}/${ruta}`)
          .set(auth)
          .send({ motivo: 'x' });
        expect(response.status).toBe(400);
        expect(response.body.codigo).toBe('VALIDACION_INVALIDA');
      }
    });
  });

  describe('edición de sala (control de versión, ADR-23)', () => {
    const patch = (body: unknown) =>
      request(createApp())
        .patch(`/api/v1/salas/${randomUUID()}`)
        .set(auth)
        .send(body as object);

    it('exige nombre y versión', async () => {
      const response = await patch({});
      expect(response.status).toBe(400);
      expect(response.body.campos).toMatchObject({
        nombre: expect.any(String),
        version: 'Indica la versión del registro que estás modificando.',
      });
    });

    it('rechaza una versión que no es un entero positivo', async () => {
      for (const version of [0, -1, 1.5, '1']) {
        expect((await patch({ nombre: 'Sala A', version })).status).toBe(400);
      }
    });
  });

  describe('listado y disponibilidad', () => {
    it('rechaza un estado de listado no previsto', async () => {
      const response = await request(createApp()).get('/api/v1/salas?estado=otras').set(auth);
      expect(response.status).toBe(400);
      expect(response.body.codigo).toBe('VALIDACION_INVALIDA');
    });

    it('la disponibilidad exige una fecha AAAA-MM-DD', async () => {
      const app = createApp();
      expect((await request(app).get('/api/v1/salas/disponibilidad').set(auth)).status).toBe(400);
      expect(
        (await request(app).get('/api/v1/salas/disponibilidad?fecha=01/03/2027').set(auth)).status,
      ).toBe(400);
    });

    it('la disponibilidad limita la duración a 1-4 bloques', async () => {
      const app = createApp();
      for (const d of [0, 5]) {
        expect(
          (
            await request(app)
              .get(`/api/v1/salas/disponibilidad?fecha=2027-03-01&duracion=${d}`)
              .set(auth)
          ).status,
        ).toBe(400);
      }
    });
  });
});
