import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { UnsavedChangesProvider } from '../../../contexts/UnsavedChangesContext';
import { therapistsApi } from '../api';
import { RegistroTerapeutaPage } from './RegistroTerapeutaPage';
import { TerapeutasPage } from './TerapeutasPage';

type Handler = (url: string, init: RequestInit) => { status: number; body?: unknown };

const json = (status: number, body?: unknown) =>
  new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

function mockApi(handler: Handler) {
  const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const result = handler(String(input), init ?? {});
    return json(result.status, result.body);
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

const available: Handler = (url) =>
  url.endsWith('/validaciones') ? { status: 200, body: { disponible: true } } : { status: 500 };

const therapist = {
  id: '7b2e1a3c-4d5e-6f7a-8b9c-0d1e2f3a4b5c',
  nombre_completo: 'Victoria Méndez Rosado',
  telefono: '9997845213',
  correo_electronico: 'victoria.mendez@correo.uady.mx',
  fecha_nacimiento: '1988-05-19',
  cedula_profesional: '7845213',
  foto_perfil: null,
  foto_actualizada_en: null,
  activo: true,
  fecha_baja: null,
  fecha_registro: '2026-10-09',
  version: 1,
};

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/inicio/terapeutas/nuevo']}>
      <UnsavedChangesProvider>
        <Routes>
          <Route path="/inicio/terapeutas" element={<TerapeutasPage />} />
          <Route
            path="/inicio/terapeutas/nuevo"
            element={<RegistroTerapeutaPage session={{ token: 'token-terapeuta-test' }} />}
          />
        </Routes>
      </UnsavedChangesProvider>
    </MemoryRouter>,
  );
}

function fillValidForm() {
  fireEvent.change(screen.getByLabelText('Nombre completo'), {
    target: { value: 'Victoria Méndez Rosado' },
  });
  fireEvent.change(screen.getByLabelText('Teléfono'), {
    target: { value: '999 784 5213' },
  });
  fireEvent.change(screen.getByLabelText('Correo electrónico'), {
    target: { value: 'victoria.mendez@correo.uady.mx' },
  });
  fireEvent.change(screen.getByLabelText('Fecha de nacimiento'), {
    target: { value: '19051988' },
  });
  fireEvent.change(screen.getByLabelText('Cédula profesional'), {
    target: { value: '7845213' },
  });
}

const requestsTo = (fetchMock: ReturnType<typeof mockApi>, suffix: string, method?: string) =>
  fetchMock.mock.calls.filter(
    ([url, init]) =>
      String(url).endsWith(suffix) && (!method || (init as RequestInit)?.method === method),
  );

beforeEach(() => {
  if (typeof URL.createObjectURL === 'undefined') {
    URL.createObjectURL = vi.fn(() => 'blob:mock-url');
  } else {
    vi.spyOn(URL, 'createObjectURL').mockImplementation(() => 'blob:mock-url');
  }
  if (typeof URL.revokeObjectURL === 'undefined') {
    URL.revokeObjectURL = vi.fn();
  } else {
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
  }
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('registro de terapeutas (EDT 4.3.4)', () => {
  it('muestra el formulario de registro con todos los campos requeridos y fotografía opcional (RF 2.1.1-2.1.15)', () => {
    mockApi(available);
    renderPage();

    expect(screen.getByRole('heading', { name: 'Nuevo terapeuta' })).toBeInTheDocument();
    expect(screen.getByText(/Fotografía/)).toBeInTheDocument();
    expect(screen.getByText(/\(opcional\)/)).toBeInTheDocument();

    for (const label of [
      'Nombre completo',
      'Teléfono',
      'Correo electrónico',
      'Fecha de nacimiento',
      'Cédula profesional',
    ]) {
      expect(screen.getByLabelText(label)).toBeInTheDocument();
    }
    expect(screen.getByRole('button', { name: 'Guardar terapeuta' })).toBeEnabled();
  });

  it('no envía con campos obligatorios vacíos y enfoca el primer error (CA-2.1-06)', async () => {
    const fetchMock = mockApi(available);
    renderPage();

    fireEvent.click(screen.getByRole('button', { name: 'Guardar terapeuta' }));

    expect(
      await screen.findByText('Hay 5 campos por corregir. Revisa los mensajes junto a cada campo.'),
    ).toBeInTheDocument();
    expect(screen.getByText('Escribe el nombre completo.')).toBeInTheDocument();
    expect(screen.getByText('Escribe el teléfono.')).toBeInTheDocument();
    expect(screen.getByText('Escribe el correo electrónico.')).toBeInTheDocument();
    expect(screen.getByText('Escribe la fecha de nacimiento.')).toBeInTheDocument();
    expect(screen.getByText('Escribe la cédula profesional.')).toBeInTheDocument();
    expect(screen.getByLabelText('Nombre completo')).toHaveFocus();
    expect(requestsTo(fetchMock, '/api/v1/terapeutas', 'POST')).toHaveLength(0);
  });

  it('rechaza fecha de nacimiento no anterior a la fecha actual (RF 2.1.9, CA-2.1-04)', () => {
    mockApi(available);
    renderPage();

    const futureYear = new Date().getFullYear() + 1;
    fireEvent.change(screen.getByLabelText('Fecha de nacimiento'), {
      target: { value: `0101${futureYear}` },
    });

    expect(screen.getByText('La fecha de nacimiento debe ser anterior a hoy.')).toBeInTheDocument();
  });

  it('rechaza cédula profesional con longitud inválida (RF 2.1.14, CA-2.1-07)', () => {
    mockApi(available);
    renderPage();

    fireEvent.change(screen.getByLabelText('Cédula profesional'), {
      target: { value: '12345' },
    });
    fireEvent.blur(screen.getByLabelText('Cédula profesional'));

    expect(screen.getByText('La cédula debe tener 7 u 8 dígitos.')).toBeInTheDocument();
  });

  it('avisa de una cédula ya registrada con la verificación anticipada (CA-2.1-03, CA-2.1-07)', async () => {
    const fetchMock = mockApi((url, init) => {
      if (url.endsWith('/validaciones')) {
        const body = JSON.parse(String(init.body)) as { campo: string };
        return body.campo === 'cedula'
          ? {
              status: 200,
              body: {
                campo: 'cedula',
                disponible: false,
                mensaje: 'Esta cédula ya está registrada.',
              },
            }
          : { status: 200, body: { campo: 'cedula', disponible: true } };
      }
      return { status: 500 };
    });
    renderPage();

    fireEvent.change(screen.getByLabelText('Cédula profesional'), {
      target: { value: '7845213' },
    });

    expect(
      await screen.findByText('Esta cédula ya está registrada.', {}, { timeout: 2000 }),
    ).toBeInTheDocument();
    const calls = requestsTo(fetchMock, '/validaciones', 'POST');
    expect(calls.length).toBeGreaterThan(0);
    const [, init] = calls[0];
    expect(JSON.parse(String(init?.body))).toEqual({
      campo: 'cedula',
      valor: '7845213',
    });
    expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer token-terapeuta-test');
  });

  it('guarda exitosamente al terapeuta sin fotografía (RF 2.1.1, RF 2.1.10, CA-2.1-01)', async () => {
    const fetchMock = mockApi((url) =>
      url.endsWith('/validaciones')
        ? { status: 200, body: { disponible: true } }
        : { status: 201, body: { codigo: 'TERAPEUTA_REGISTRADO', terapeuta: therapist } },
    );
    renderPage();
    fillValidForm();

    fireEvent.click(screen.getByRole('button', { name: 'Guardar terapeuta' }));

    expect(await screen.findByText('Terapeuta registrado.')).toBeInTheDocument();
    const calls = requestsTo(fetchMock, '/api/v1/terapeutas', 'POST');
    expect(calls).toHaveLength(1);
    const [[, init]] = calls;
    expect(JSON.parse(String(init?.body))).toEqual({
      nombre_completo: 'Victoria Méndez Rosado',
      telefono: '9997845213',
      correo_electronico: 'victoria.mendez@correo.uady.mx',
      fecha_nacimiento: '1988-05-19',
      cedula_profesional: '7845213',
    });
    expect(new Headers(init?.headers).get('Idempotency-Key')).toBeTruthy();
  });

  it('valida formato y dimensiones de la fotografía (RF 2.1.11 a 2.1.13, CA-2.1-05)', async () => {
    mockApi(available);
    const { container } = renderPage();

    const input = container.querySelector('#photo-input') as HTMLInputElement;
    expect(input).toBeInTheDocument();

    // 1. Archivo con tipo no permitido
    const txtFile = new File(['hello'], 'documento.txt', { type: 'text/plain' });
    fireEvent.change(input, { target: { files: [txtFile] } });
    expect(await screen.findByText('Usa una fotografía JPEG o PNG.')).toBeInTheDocument();

    // 2. Archivo mayor a 5 MB
    const bigFile = new File([new Uint8Array(5 * 1024 * 1024 + 10)], 'foto_grande.jpg', {
      type: 'image/jpeg',
    });
    fireEvent.change(input, { target: { files: [bigFile] } });
    expect(
      await screen.findByText('La fotografía no puede pesar más de 5 MB.'),
    ).toBeInTheDocument();

    // 3. Imagen con dimensiones menores a 200x200
    vi.stubGlobal(
      'createImageBitmap',
      vi.fn().mockResolvedValue({
        width: 150,
        height: 150,
        close: vi.fn(),
      }),
    );
    const smallImg = new File([new Uint8Array(100)], 'pequena.jpg', { type: 'image/jpeg' });
    fireEvent.change(input, { target: { files: [smallImg] } });
    expect(
      await screen.findByText(/La fotografía debe medir al menos 200 x 200 píxeles/),
    ).toBeInTheDocument();

    // 4. Imagen válida >= 200x200
    vi.stubGlobal(
      'createImageBitmap',
      vi.fn().mockResolvedValue({
        width: 400,
        height: 400,
        close: vi.fn(),
      }),
    );
    const validImg = new File([new Uint8Array(100)], 'valida.jpg', { type: 'image/jpeg' });
    fireEvent.change(input, { target: { files: [validImg] } });
    expect(await screen.findByText('valida.jpg')).toBeInTheDocument();
    expect(screen.getByText(/400 x 400 px/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Quitar' })).toBeInTheDocument();

    // Quitar fotografía
    fireEvent.click(screen.getByRole('button', { name: 'Quitar' }));
    expect(screen.queryByText('valida.jpg')).not.toBeInTheDocument();
  });

  it('realiza guardado en dos pasos con fotografía y maneja recuperación si la foto falla (PG-DSN-002 5.8)', async () => {
    vi.stubGlobal(
      'createImageBitmap',
      vi.fn().mockResolvedValue({
        width: 300,
        height: 300,
        close: vi.fn(),
      }),
    );

    mockApi((url, init) => {
      if (url.endsWith('/validaciones')) return { status: 200, body: { disponible: true } };
      if (url.endsWith('/api/v1/terapeutas') && (init as RequestInit).method === 'POST') {
        return { status: 201, body: { codigo: 'TERAPEUTA_REGISTRADO', terapeuta: therapist } };
      }
      return { status: 404 };
    });

    const uploadSpy = vi
      .spyOn(therapistsApi, 'uploadPhoto')
      .mockRejectedValueOnce({ codigo: 'ERROR_CARGA_FOTO', mensaje: 'Fallo al almacenar' })
      .mockResolvedValueOnce({ codigo: 'FOTO_ACTUALIZADA', terapeuta: therapist });

    const { container } = renderPage();
    fillValidForm();

    const validImg = new File([new Uint8Array(100)], 'foto.png', { type: 'image/png' });
    const input = container.querySelector('#photo-input') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [validImg] } });
    expect(await screen.findByText('foto.png')).toBeInTheDocument();

    // Guardar terapeuta
    fireEvent.click(screen.getByRole('button', { name: 'Guardar terapeuta' }));

    // Terapeuta creado pero foto falló -> muestra aviso con opciones de recuperación
    expect(
      await screen.findByText('Los datos del terapeuta se guardaron. Falta cargar la fotografía.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reintentar' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Continuar sin fotografía' })).toBeInTheDocument();

    // Si elige "Continuar sin fotografía"
    fireEvent.click(screen.getByRole('button', { name: 'Continuar sin fotografía' }));
    expect(await screen.findByText('Terapeuta registrado.')).toBeInTheDocument();
    expect(uploadSpy).toHaveBeenCalledTimes(1);
  });

  it('conserva datos ante falla de red y reintenta con misma Idempotency-Key (CA-2.1-09)', async () => {
    let attempts = 0;
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/validaciones') || !init) return json(200, { disponible: true });
      attempts += 1;
      if (attempts === 1) throw new TypeError('Failed to fetch');
      return json(201, { codigo: 'TERAPEUTA_REGISTRADO', terapeuta: therapist });
    });
    vi.stubGlobal('fetch', fetchMock);
    renderPage();
    fillValidForm();

    fireEvent.click(screen.getByRole('button', { name: 'Guardar terapeuta' }));

    expect(await screen.findByText(/Tus datos siguen en el formulario/)).toBeInTheDocument();
    expect(screen.getByLabelText('Nombre completo')).toHaveValue('Victoria Méndez Rosado');

    fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }));

    expect(await screen.findByText('Terapeuta registrado.')).toBeInTheDocument();
    const keys = fetchMock.mock.calls
      .filter(([url]) => String(url).endsWith('/api/v1/terapeutas'))
      .map(([, init]) => new Headers(init?.headers).get('Idempotency-Key'));
    expect(keys).toHaveLength(2);
    expect(keys[0]).toBe(keys[1]);
  });

  it('muestra errores de unicidad devueltos por el servidor (CA-2.1-03)', async () => {
    mockApi((url) =>
      url.endsWith('/validaciones')
        ? { status: 200, body: { disponible: true } }
        : {
            status: 409,
            body: {
              codigo: 'CEDULA_EN_USO',
              mensaje: 'La cédula profesional ya está registrada.',
              campos: { cedula_profesional: 'Esta cédula ya pertenece a otro terapeuta.' },
            },
          },
    );
    renderPage();
    fillValidForm();

    fireEvent.click(screen.getByRole('button', { name: 'Guardar terapeuta' }));

    expect(
      await screen.findByText('Esta cédula ya pertenece a otro terapeuta.'),
    ).toBeInTheDocument();
    expect(screen.getByText(/Hay 1 campo por corregir/)).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByLabelText('Cédula profesional')).toHaveFocus();
    });
  });

  it('solicita confirmación antes de salir si hay cambios sin guardar', async () => {
    mockApi(available);
    renderPage();
    fireEvent.change(screen.getByLabelText('Nombre completo'), {
      target: { value: 'Victoria' },
    });

    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));

    expect(screen.getByRole('dialog', { name: '¿Salir sin guardar?' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Seguir editando' })).toHaveFocus();

    fireEvent.click(screen.getByRole('button', { name: 'Salir sin guardar' }));

    await waitFor(() =>
      expect(screen.getByRole('heading', { name: 'Terapeutas' })).toBeInTheDocument(),
    );
  });
});
