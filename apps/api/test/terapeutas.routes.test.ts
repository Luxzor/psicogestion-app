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
});

