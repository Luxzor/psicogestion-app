import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';

describe('GET /api/v1/health', () => {
  it('responde con el estado de vida de la API', async () => {
    const response = await request(createApp()).get('/api/v1/health');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: 'ok', service: 'psicogestion-api' });
  });

  it('devuelve un error controlado cuando el JSON es inválido', async () => {
    const response = await request(createApp())
      .post('/api/v1/auth/login')
      .set('Content-Type', 'application/json')
      .send('{');

    expect(response.status).toBe(400);
    expect(response.body.codigo).toBe('JSON_INVALIDO');
    expect(response.body.correlation_id).toBeTypeOf('string');
  });
});
