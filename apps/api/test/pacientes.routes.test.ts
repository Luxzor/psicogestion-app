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

  it('rechaza el listado y el perfil sin una sesión activa (CA-3.2-05)', async () => {
    const lista = await request(createApp()).get('/api/v1/pacientes');
    expect(lista.status).toBe(401);
    expect(lista.body.codigo).toBe('SESION_INVALIDA');

    const perfil = await request(createApp()).get(`/api/v1/pacientes/${randomUUID()}`);
    expect(perfil.status).toBe(401);

    const edicion = await request(createApp())
      .patch(`/api/v1/pacientes/${randomUUID()}`)
      .send({ version: 1 });
    expect(edicion.status).toBe(401);
  });

  it('valida el identificador antes de consultar o editar el perfil', async () => {
    const perfil = await request(createApp())
      .get('/api/v1/pacientes/no-es-un-uuid')
      .set('Authorization', `Bearer ${token}`);
    expect(perfil.status).toBe(400);
    expect(perfil.body.codigo).toBe('VALIDACION_INVALIDA');

    const edicion = await request(createApp())
      .patch('/api/v1/pacientes/no-es-un-uuid')
      .set('Authorization', `Bearer ${token}`)
      .send({ version: 1 });
    expect(edicion.status).toBe(400);
  });

  describe('parámetros del listado (EDT 4.3.2)', () => {
    const get = (query: string) =>
      request(createApp()).get(`/api/v1/pacientes${query}`).set('Authorization', `Bearer ${token}`);

    it('rechaza un tamaño de página mayor a 100', async () => {
      const response = await get('?tamano=101');
      expect(response.status).toBe(400);
      expect(response.body.codigo).toBe('VALIDACION_INVALIDA');
    });

    it('rechaza un tamaño de página de 0', async () => {
      expect((await get('?tamano=0')).status).toBe(400);
    });

    it('rechaza una página inválida', async () => {
      expect((await get('?pagina=0')).status).toBe(400);
      expect((await get('?pagina=abc')).status).toBe(400);
    });

    it('rechaza un orden desconocido', async () => {
      expect((await get('?orden=curp')).status).toBe(400);
    });

    it('rechaza un estado distinto de activos o inactivos (EDT 4.3.3)', async () => {
      const response = await get('?estado=todos');
      expect(response.status).toBe(400);
      expect(response.body.campos.estado).toBeDefined();
    });
  });

  describe('edición de pacientes (EDT 4.3.2, ADR-10)', () => {
    const patch = (body: unknown) =>
      request(createApp())
        .patch(`/api/v1/pacientes/${randomUUID()}`)
        .set('Authorization', `Bearer ${token}`)
        .send(body as object);

    it('rechaza un PATCH sin la versión del perfil', async () => {
      const response = await patch({ telefono: '9991234567' });
      expect(response.status).toBe(400);
      expect(response.body.codigo).toBe('VALIDACION_INVALIDA');
    });

    it('rechaza un cuerpo con solo version antes de tocar la base de datos (SIN_CAMBIOS)', async () => {
      // El servicio corta antes de cualquier consulta, así que no hace falta un paciente real.
      const response = await patch({ version: 1 });
      expect(response.status).toBe(400);
      expect(response.body.codigo).toBe('SIN_CAMBIOS');
    });

    it('rechaza campos desconocidos o de solo lectura en el cuerpo', async () => {
      expect((await patch({ version: 1, activo: false })).status).toBe(400);
      expect((await patch({ version: 1, id: randomUUID() })).status).toBe(400);
      expect((await patch({ version: 1, created_by: randomUUID() })).status).toBe(400);
    });

    it('rechaza una fecha de nacimiento con formato inválido', async () => {
      const response = await patch({ version: 1, fecha_nacimiento: '08/10/2026' });
      expect(response.status).toBe(400);
      expect(response.body.campos.fecha_nacimiento).toBeDefined();
    });
  });
  describe('baja y reactivación desde el perfil (EDT 4.3.3)', () => {
    const post = (path: string, body?: unknown) => {
      const call = request(createApp())
        .post(`/api/v1/pacientes${path}`)
        .set('Authorization', `Bearer ${token}`);
      return body === undefined ? call : call.send(body as object);
    };

    it('rechaza la baja y la reactivación sin una sesión activa', async () => {
      const baja = await request(createApp()).post(`/api/v1/pacientes/${randomUUID()}/baja`);
      expect(baja.status).toBe(401);
      expect(baja.body.codigo).toBe('SESION_INVALIDA');

      const reactivacion = await request(createApp()).post(
        `/api/v1/pacientes/${randomUUID()}/reactivacion`,
      );
      expect(reactivacion.status).toBe(401);
    });

    it('valida el identificador antes de dar de baja', async () => {
      const response = await post('/no-es-un-uuid/baja');
      expect(response.status).toBe(400);
      expect(response.body.codigo).toBe('VALIDACION_INVALIDA');
    });

    it('rechaza datos en el cuerpo de la baja antes de tocar la base de datos', async () => {
      const response = await post(`/${randomUUID()}/baja`, { activo: true });
      expect(response.status).toBe(400);
      expect(response.body.codigo).toBe('VALIDACION_INVALIDA');
    });

    it('rechaza una llave de idempotencia con formato inválido en la baja', async () => {
      const response = await request(createApp())
        .post(`/api/v1/pacientes/${randomUUID()}/baja`)
        .set('Authorization', `Bearer ${token}`)
        .set('Idempotency-Key', 'no válida');
      expect(response.status).toBe(400);
      expect(response.body.codigo).toBe('IDEMPOTENCY_KEY_INVALIDA');
    });

    it('una reactivación con datos incompletos se valida como el registro', async () => {
      const response = await post(`/${randomUUID()}/reactivacion`, { nombre_completo: 'Ana' });
      expect(response.status).toBe(400);
      expect(response.body.campos.curp).toBeDefined();
    });
  });
});
