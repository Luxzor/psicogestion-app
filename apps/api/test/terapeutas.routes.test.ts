import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { tokenService } from '../src/modules/auth/tokens.js';

const token = tokenService.createAccessToken({ id: randomUUID(), rol: 'administrador' });

// Generador de buffer de imagen PNG válida de dimensiones variables
function createPngBuffer(width: number, height: number): Buffer {
  const buf = Buffer.alloc(33);
  // PNG signature
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(buf, 0);
  // IHDR length = 13
  buf.writeUInt32BE(13, 8);
  // 'IHDR'
  Buffer.from('IHDR').copy(buf, 12);
  // Width & height
  buf.writeUInt32BE(width, 16);
  buf.writeUInt32BE(height, 20);
  // Bit depth 8, color type 2 (RGB), compression 0, filter 0, interlace 0
  Buffer.from([0x08, 0x02, 0x00, 0x00, 0x00]).copy(buf, 24);
  // CRC
  buf.writeUInt32BE(0x12345678, 29);
  return buf;
}

describe('rutas de terapeutas sin dependencias externas (EDT 4.3.4)', () => {
  it('rechaza el registro sin una sesión activa', async () => {
    const response = await request(createApp()).post('/api/v1/terapeutas').send({});

    expect(response.status).toBe(401);
    expect(response.body.codigo).toBe('SESION_INVALIDA');
  });

  it('rechaza un access token inválido', async () => {
    const response = await request(createApp())
      .post('/api/v1/terapeutas/validaciones')
      .set('Authorization', 'Bearer token-invalido')
      .send({ campo: 'telefono', valor: '9997845213' });

    expect(response.status).toBe(401);
  });

  it('devuelve los errores por campo cuando faltan datos obligatorios (RNF 2.1.1, CA-2.1-06)', async () => {
    const response = await request(createApp())
      .post('/api/v1/terapeutas')
      .set('Authorization', `Bearer ${token}`)
      .send({ nombre_completo: 'a'.repeat(51), telefono: '99945' });

    expect(response.status).toBe(400);
    expect(response.body.codigo).toBe('VALIDACION_INVALIDA');
    expect(response.body.campos).toMatchObject({
      nombre_completo: 'El nombre no puede tener más de 50 caracteres.',
      telefono: 'El teléfono debe tener exactamente 10 dígitos.',
      correo_electronico: 'Escribe el correo electrónico.',
      fecha_nacimiento: expect.any(String),
      cedula_profesional: 'Escribe la cédula profesional.',
    });
  });

  it('rechaza una llave de idempotencia con formato inválido', async () => {
    const response = await request(createApp())
      .post('/api/v1/terapeutas')
      .set('Authorization', `Bearer ${token}`)
      .set('Idempotency-Key', 'no válida')
      .send({
        nombre_completo: 'Victoria Méndez Rosado',
        telefono: '9997845213',
        correo_electronico: 'victoria.mendez@correo.uady.mx',
        fecha_nacimiento: '1988-05-19',
        cedula_profesional: '7845213',
      });

    expect(response.status).toBe(400);
    expect(response.body.codigo).toBe('IDEMPOTENCY_KEY_INVALIDA');
  });

  it('rechaza una fotografía de formato no admitido (415 FOTO_FORMATO_INVALIDO, CA-2.1-05)', async () => {
    const gifBuffer = Buffer.from('GIF89a200200');
    const response = await request(createApp())
      .put(`/api/v1/terapeutas/${randomUUID()}/foto`)
      .set('Authorization', `Bearer ${token}`)
      .set('Content-Type', 'image/gif')
      .send(gifBuffer);

    expect(response.status).toBe(415);
    expect(response.body.codigo).toBe('FOTO_FORMATO_INVALIDO');
  });

  it('rechaza una fotografía menor a 200 x 200 px (422 FOTO_DIMENSIONES_INSUFICIENTES, CA-2.1-05)', async () => {
    const smallPng = createPngBuffer(150, 180);
    const response = await request(createApp())
      .put(`/api/v1/terapeutas/${randomUUID()}/foto`)
      .set('Authorization', `Bearer ${token}`)
      .set('Content-Type', 'image/png')
      .send(smallPng);

    expect(response.status).toBe(422);
    expect(response.body.codigo).toBe('FOTO_DIMENSIONES_INSUFICIENTES');
    expect(response.body.mensaje).toContain('200 x 200');
  });

  it('rechaza una fotografía que excede los 5 MB (413 FOTO_MUY_GRANDE, CA-2.1-05)', async () => {
    const largeBuffer = Buffer.alloc(5.5 * 1024 * 1024);
    const response = await request(createApp())
      .put(`/api/v1/terapeutas/${randomUUID()}/foto`)
      .set('Authorization', `Bearer ${token}`)
      .set('Content-Type', 'image/jpeg')
      .send(largeBuffer);

    expect(response.status).toBe(413);
    expect(response.body.codigo).toBe('FOTO_MUY_GRANDE');
  });

  it('valida el UUID del terapeuta en la ruta de fotografía', async () => {
    const response = await request(createApp())
      .get('/api/v1/terapeutas/id-invalido/foto')
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(400);
    expect(response.body.codigo).toBe('VALIDACION_INVALIDA');
  });

  describe('parámetros del listado (EDT 4.3.5)', () => {
    const get = (query: string) =>
      request(createApp())
        .get(`/api/v1/terapeutas${query}`)
        .set('Authorization', `Bearer ${token}`);

    it('rechaza el listado sin una sesión activa', async () => {
      const response = await request(createApp()).get('/api/v1/terapeutas');
      expect(response.status).toBe(401);
      expect(response.body.codigo).toBe('SESION_INVALIDA');
    });

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
      expect((await get('?orden=cedula_profesional')).status).toBe(400);
    });

    it('rechaza un estado distinto de activos, inactivos o todos (CA-2.2-01)', async () => {
      const response = await get('?estado=baja');
      expect(response.status).toBe(400);
      expect(response.body.campos.estado).toBeDefined();
    });

    it('rechaza un parámetro de consulta desconocido', async () => {
      const response = await get('?buscar=victoria');
      expect(response.status).toBe(400);
      expect(response.body.codigo).toBe('VALIDACION_INVALIDA');
    });
  });

  describe('perfil y edición de terapeutas (EDT 4.3.5, ADR-10)', () => {
    it('rechaza el perfil y la edición sin una sesión activa', async () => {
      const perfil = await request(createApp()).get(`/api/v1/terapeutas/${randomUUID()}`);
      expect(perfil.status).toBe(401);
      expect(perfil.body.codigo).toBe('SESION_INVALIDA');

      const edicion = await request(createApp())
        .patch(`/api/v1/terapeutas/${randomUUID()}`)
        .send({ version: 1 });
      expect(edicion.status).toBe(401);
    });

    it('valida el identificador antes de consultar o editar el perfil', async () => {
      const perfil = await request(createApp())
        .get('/api/v1/terapeutas/no-es-un-uuid')
        .set('Authorization', `Bearer ${token}`);
      expect(perfil.status).toBe(400);
      expect(perfil.body.codigo).toBe('VALIDACION_INVALIDA');

      const edicion = await request(createApp())
        .patch('/api/v1/terapeutas/no-es-un-uuid')
        .set('Authorization', `Bearer ${token}`)
        .send({ version: 1 });
      expect(edicion.status).toBe(400);
    });

    const patch = (body: unknown) =>
      request(createApp())
        .patch(`/api/v1/terapeutas/${randomUUID()}`)
        .set('Authorization', `Bearer ${token}`)
        .send(body as object);

    it('rechaza un PATCH sin la versión del perfil', async () => {
      const response = await patch({ telefono: '9991234567' });
      expect(response.status).toBe(400);
      expect(response.body.codigo).toBe('VALIDACION_INVALIDA');
    });

    it('rechaza un cuerpo con solo version antes de tocar la base de datos (SIN_CAMBIOS)', async () => {
      // El servicio corta antes de cualquier consulta, así que no hace falta un terapeuta real.
      const response = await patch({ version: 1 });
      expect(response.status).toBe(400);
      expect(response.body.codigo).toBe('SIN_CAMBIOS');
    });

    it('rechaza campos desconocidos o de solo lectura en el cuerpo', async () => {
      expect((await patch({ version: 1, activo: false })).status).toBe(400);
      expect((await patch({ version: 1, id: randomUUID() })).status).toBe(400);
      expect((await patch({ version: 1, foto_perfil: 'x' })).status).toBe(400);
    });

    it('rechaza una fecha de nacimiento con formato inválido', async () => {
      const response = await patch({ version: 1, fecha_nacimiento: '19/05/1988' });
      expect(response.status).toBe(400);
      expect(response.body.campos.fecha_nacimiento).toBeDefined();
    });

    it('rechaza una cédula de 6 dígitos antes de tocar la base de datos', async () => {
      const response = await patch({ version: 1, cedula_profesional: '123456' });
      expect(response.status).toBe(400);
      expect(response.body.campos.cedula_profesional).toBeDefined();
    });
  });

  describe('entrega de la fotografía con tam (EDT 4.3.5)', () => {
    it('rechaza la entrega de la foto sin una sesión activa, con cualquier tam', async () => {
      const id = randomUUID();
      const perfil = await request(createApp()).get(`/api/v1/terapeutas/${id}/foto?tam=perfil`);
      expect(perfil.status).toBe(401);

      const miniatura = await request(createApp()).get(
        `/api/v1/terapeutas/${id}/foto?tam=miniatura`,
      );
      expect(miniatura.status).toBe(401);
    });

    it('rechaza un tam distinto de perfil o miniatura antes de leer el archivo', async () => {
      const response = await request(createApp())
        .get(`/api/v1/terapeutas/${randomUUID()}/foto?tam=original`)
        .set('Authorization', `Bearer ${token}`);

      expect(response.status).toBe(400);
      expect(response.body.codigo).toBe('VALIDACION_INVALIDA');
    });
  });

  describe('baja y reactivación desde el perfil (EDT 4.3.5)', () => {
    const post = (path: string, body?: unknown) => {
      const call = request(createApp())
        .post(`/api/v1/terapeutas${path}`)
        .set('Authorization', `Bearer ${token}`);
      return body === undefined ? call : call.send(body as object);
    };

    it('rechaza la baja y la reactivación sin una sesión activa', async () => {
      const baja = await request(createApp()).post(`/api/v1/terapeutas/${randomUUID()}/baja`);
      expect(baja.status).toBe(401);
      expect(baja.body.codigo).toBe('SESION_INVALIDA');

      const reactivar = await request(createApp()).post(
        `/api/v1/terapeutas/${randomUUID()}/reactivar`,
      );
      expect(reactivar.status).toBe(401);
    });

    it('valida el identificador antes de dar de baja o de reactivar', async () => {
      expect((await post('/no-es-un-uuid/baja')).status).toBe(400);
      expect((await post('/no-es-un-uuid/reactivar')).status).toBe(400);
    });

    it('rechaza datos en el cuerpo de la baja y de la reactivación antes de tocar la base de datos', async () => {
      const baja = await post(`/${randomUUID()}/baja`, { activo: true });
      expect(baja.status).toBe(400);
      expect(baja.body.codigo).toBe('VALIDACION_INVALIDA');

      const reactivar = await post(`/${randomUUID()}/reactivar`, { nombre_completo: 'Victoria' });
      expect(reactivar.status).toBe(400);
      expect(reactivar.body.codigo).toBe('VALIDACION_INVALIDA');
    });

    it('rechaza una llave de idempotencia con formato inválido en la baja', async () => {
      const response = await request(createApp())
        .post(`/api/v1/terapeutas/${randomUUID()}/baja`)
        .set('Authorization', `Bearer ${token}`)
        .set('Idempotency-Key', 'no válida');
      expect(response.status).toBe(400);
      expect(response.body.codigo).toBe('IDEMPOTENCY_KEY_INVALIDA');
    });
  });
});
