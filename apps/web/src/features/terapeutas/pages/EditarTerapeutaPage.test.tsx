import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { UnsavedChangesProvider } from '../../../contexts/UnsavedChangesContext';
import { therapistsApi } from '../api';
import { EditarTerapeutaPage } from './EditarTerapeutaPage';

type Handler = (
  url: string,
  init: RequestInit,
) => { status: number; body?: unknown; isPhoto?: boolean };

function responseFor(result: ReturnType<Handler>) {
  if (result.isPhoto) {
    return new Response(new Uint8Array([1, 2, 3, 4]), {
      status: result.status,
      headers: { 'Content-Type': 'image/png' },
    });
  }
  return new Response(result.body === undefined ? null : JSON.stringify(result.body), {
    status: result.status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function mockApi(handler: Handler) {
  const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const result = handler(String(input), init ?? {});
    return responseFor(result);
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

const therapist = {
  id: 'terapeuta-1',
  nombre_completo: 'Victoria Méndez Rosado',
  telefono: '9997845213',
  correo_electronico: 'victoria.mendez@correo.uady.mx',
  fecha_nacimiento: '1988-05-19',
  cedula_profesional: '7845213',
  foto_perfil: null as string | null,
  foto_actualizada_en: null as string | null,
  activo: true,
  fecha_baja: null,
  fecha_registro: '2026-01-01',
  version: 1,
};

/** Doble del perfil: muestra lo que quedó en caché tras el PATCH (RNF 2.2.6, ADR-12) y el aviso. */
function PerfilStub() {
  const flash = (useLocation().state as { flash?: { text: string } } | null)?.flash;
  return (
    <>
      <h1>Perfil del terapeuta</h1>
      {flash ? <p>{flash.text}</p> : null}
    </>
  );
}

function ListStub() {
  return <h1>Terapeutas</h1>;
}

function renderPage(initialProfile: typeof therapist = therapist) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <UnsavedChangesProvider>
        <MemoryRouter initialEntries={[`/inicio/terapeutas/${initialProfile.id}/editar`]}>
          <Routes>
            <Route path="/inicio/terapeutas" element={<ListStub />} />
            <Route path="/inicio/terapeutas/:id" element={<PerfilStub />} />
            <Route
              path="/inicio/terapeutas/:id/editar"
              element={<EditarTerapeutaPage session={{ token: 'token-de-prueba' }} />}
            />
          </Routes>
        </MemoryRouter>
      </UnsavedChangesProvider>
    </QueryClientProvider>,
  );
}

const patchesTo = (fetchMock: ReturnType<typeof mockApi>) =>
  fetchMock.mock.calls.filter(([, init]) => (init as RequestInit)?.method === 'PATCH');
const getsAlDetalle = (fetchMock: ReturnType<typeof mockApi>) =>
  fetchMock.mock.calls.filter(
    ([url, init]) =>
      String(url) === `/api/v1/terapeutas/${therapist.id}` &&
      (!init || (init as RequestInit).method === undefined),
  );

const sinFoto: Handler = (url) =>
  url.includes('/foto') ? { status: 404, isPhoto: true } : { status: 200, body: { terapeuta: therapist } };

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('edición de terapeutas (EDT 4.3.5, RF 2.2.3–2.2.5)', () => {
  it('"Guardar cambios" está deshabilitado sin diferencias', async () => {
    mockApi(sinFoto);
    renderPage();

    await screen.findByLabelText('Teléfono');
    expect(screen.getByRole('button', { name: 'Guardar cambios' })).toBeDisabled();
  });

  it('edita un solo campo: el PATCH envía solo ese campo más la versión (RNF 2.2.3, ADR-10)', async () => {
    const fetchMock = mockApi((url, init) => {
      if (url.includes('/foto')) return { status: 404, isPhoto: true };
      if (url.includes('/validaciones')) return { status: 200, body: { disponible: true } };
      if (init.method === 'PATCH') {
        return {
          status: 200,
          body: {
            codigo: 'TERAPEUTA_ACTUALIZADO',
            terapeuta: { ...therapist, telefono: '9991112222', version: 2 },
          },
        };
      }
      return { status: 200, body: { terapeuta: therapist } };
    });
    renderPage();

    const telefono = await screen.findByLabelText('Teléfono');
    const guardar = screen.getByRole('button', { name: 'Guardar cambios' });
    expect(guardar).toBeDisabled();

    fireEvent.change(telefono, { target: { value: '9991112222' } });
    expect(guardar).toBeEnabled();
    fireEvent.click(guardar);

    expect(await screen.findByText('Cambios guardados.')).toBeInTheDocument();
    const [, init] = patchesTo(fetchMock)[0];
    expect(JSON.parse(String(init?.body))).toEqual({ telefono: '9991112222', version: 1 });
  });

  const conflictOn = (field: 'telefono' | 'correo_electronico' | 'cedula_profesional') => {
    const codes = {
      telefono: 'TELEFONO_EN_USO',
      correo_electronico: 'CORREO_EN_USO',
      cedula_profesional: 'CEDULA_EN_USO',
    } as const;
    return {
      status: 409,
      body: {
        codigo: codes[field],
        mensaje: 'Este dato ya está registrado en otro terapeuta.',
        campos: { [field]: 'Este dato ya está registrado en otro terapeuta.' },
      },
    };
  };

  it('rechaza un teléfono duplicado junto al campo (§5.12.6)', async () => {
    mockApi((url, init) => {
      if (url.includes('/foto')) return { status: 404, isPhoto: true };
      if (url.includes('/validaciones')) return { status: 200, body: { disponible: true } };
      if (init.method === 'PATCH') return conflictOn('telefono');
      return { status: 200, body: { terapeuta: therapist } };
    });
    renderPage();

    fireEvent.change(await screen.findByLabelText('Teléfono'), { target: { value: '9998887777' } });
    fireEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }));

    expect(
      await screen.findByText('Este dato ya está registrado en otro terapeuta.'),
    ).toBeInTheDocument();
    expect(screen.getByLabelText('Teléfono')).toHaveFocus();
  });

  it('rechaza un correo duplicado junto al campo (§5.12.6)', async () => {
    mockApi((url, init) => {
      if (url.includes('/foto')) return { status: 404, isPhoto: true };
      if (url.includes('/validaciones')) return { status: 200, body: { disponible: true } };
      if (init.method === 'PATCH') return conflictOn('correo_electronico');
      return { status: 200, body: { terapeuta: therapist } };
    });
    renderPage();

    fireEvent.change(await screen.findByLabelText(/Correo electrónico/), {
      target: { value: 'otro@correo.uady.mx' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }));

    expect(
      await screen.findByText('Este dato ya está registrado en otro terapeuta.'),
    ).toBeInTheDocument();
    expect(screen.getByLabelText(/Correo electrónico/)).toHaveFocus();
  });

  it('rechaza una cédula duplicada junto al campo (§5.12.6)', async () => {
    mockApi((url, init) => {
      if (url.includes('/foto')) return { status: 404, isPhoto: true };
      if (url.includes('/validaciones')) return { status: 200, body: { disponible: true } };
      if (init.method === 'PATCH') return conflictOn('cedula_profesional');
      return { status: 200, body: { terapeuta: therapist } };
    });
    renderPage();

    fireEvent.change(await screen.findByLabelText('Cédula profesional'), {
      target: { value: '9999999' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }));

    expect(
      await screen.findByText('Este dato ya está registrado en otro terapeuta.'),
    ).toBeInTheDocument();
    expect(screen.getByLabelText('Cédula profesional')).toHaveFocus();
  });

  it('rechaza una fecha de nacimiento futura y una cédula de 6 dígitos', async () => {
    mockApi(sinFoto);
    renderPage();

    fireEvent.change(await screen.findByLabelText('Fecha de nacimiento'), {
      target: { value: '01/01/2999' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }));
    expect(
      await screen.findByText('La fecha de nacimiento debe ser anterior a hoy.'),
    ).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Fecha de nacimiento'), { target: { value: '19/05/1988' } });
    fireEvent.change(screen.getByLabelText('Cédula profesional'), { target: { value: '123456' } });
    fireEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }));
    expect(await screen.findByText('La cédula debe tener 7 u 8 dígitos.')).toBeInTheDocument();
  });

  it('cambia la fotografía: PATCH primero, la foto después (§5.9)', async () => {
    vi.stubGlobal(
      'createImageBitmap',
      vi.fn().mockResolvedValue({ width: 300, height: 300, close: vi.fn() }),
    );
    const fetchMock = mockApi((url, init) => {
      if (url.includes('/foto')) return { status: 404, isPhoto: true };
      if (url.includes('/validaciones')) return { status: 200, body: { disponible: true } };
      if (init.method === 'PATCH') {
        return {
          status: 200,
          body: {
            codigo: 'TERAPEUTA_ACTUALIZADO',
            terapeuta: { ...therapist, telefono: '9991112222', version: 2 },
          },
        };
      }
      return { status: 200, body: { terapeuta: therapist } };
    });
    const uploadSpy = vi.spyOn(therapistsApi, 'uploadPhoto').mockResolvedValue({
      codigo: 'FOTO_ACTUALIZADA',
      terapeuta: {
        ...therapist,
        telefono: '9991112222',
        version: 2,
        foto_actualizada_en: '2026-01-02T00:00:00.000Z',
      },
    });

    const { container } = renderPage();
    fireEvent.change(await screen.findByLabelText('Teléfono'), { target: { value: '9991112222' } });

    const validImg = new File([new Uint8Array(100)], 'foto.png', { type: 'image/png' });
    const input = container.querySelector('#photo-input') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [validImg] } });
    expect(await screen.findByText('foto.png')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }));

    expect(await screen.findByText('Cambios guardados.')).toBeInTheDocument();
    expect(patchesTo(fetchMock)).toHaveLength(1);
    expect(uploadSpy).toHaveBeenCalledTimes(1);
  });

  it('quita la fotografía existente: llama a DELETE y no a la carga', async () => {
    mockApi((url) => {
      if (url.includes('/foto')) return { status: 200, isPhoto: true }; // hay foto existente
      return {
        status: 200,
        body: { terapeuta: { ...therapist, foto_actualizada_en: '2026-01-01T00:00:00.000Z' } },
      };
    });
    const deleteSpy = vi.spyOn(therapistsApi, 'deletePhoto').mockResolvedValue(undefined);
    const uploadSpy = vi.spyOn(therapistsApi, 'uploadPhoto');

    renderPage();
    await screen.findByLabelText('Teléfono');

    fireEvent.click(await screen.findByRole('button', { name: 'Quitar' }));
    const guardar = screen.getByRole('button', { name: 'Guardar cambios' });
    expect(guardar).toBeEnabled();
    fireEvent.click(guardar);

    expect(await screen.findByText('Cambios guardados.')).toBeInTheDocument();
    expect(deleteSpy).toHaveBeenCalledWith(therapist.id, 'token-de-prueba');
    expect(uploadSpy).not.toHaveBeenCalled();
  });

  it('si el PATCH tiene éxito y la foto falla, ofrece "Reintentar" y "Continuar sin cambiar la fotografía"', async () => {
    vi.stubGlobal(
      'createImageBitmap',
      vi.fn().mockResolvedValue({ width: 300, height: 300, close: vi.fn() }),
    );
    mockApi((url, init) => {
      if (url.includes('/foto')) return { status: 404, isPhoto: true };
      if (url.includes('/validaciones')) return { status: 200, body: { disponible: true } };
      if (init.method === 'PATCH') {
        return {
          status: 200,
          body: {
            codigo: 'TERAPEUTA_ACTUALIZADO',
            terapeuta: { ...therapist, telefono: '9991112222', version: 2 },
          },
        };
      }
      return { status: 200, body: { terapeuta: therapist } };
    });
    const uploadSpy = vi
      .spyOn(therapistsApi, 'uploadPhoto')
      .mockRejectedValueOnce({ codigo: 'ERROR_CARGA_FOTO', mensaje: 'Fallo al almacenar' })
      .mockResolvedValueOnce({
        codigo: 'FOTO_ACTUALIZADA',
        terapeuta: {
          ...therapist,
          telefono: '9991112222',
          version: 2,
          foto_actualizada_en: '2026-01-02T00:00:00.000Z',
        },
      });

    const { container } = renderPage();
    fireEvent.change(await screen.findByLabelText('Teléfono'), { target: { value: '9991112222' } });

    const validImg = new File([new Uint8Array(100)], 'foto.png', { type: 'image/png' });
    const input = container.querySelector('#photo-input') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [validImg] } });
    await screen.findByText('foto.png');

    fireEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }));

    expect(
      await screen.findByText(
        'Los cambios se guardaron, pero no fue posible actualizar la fotografía.',
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reintentar' })).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Continuar sin cambiar la fotografía' }),
    ).toBeInTheDocument();
    expect(screen.getByText('foto.png')).toBeInTheDocument(); // la imagen sigue en memoria

    fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }));
    expect(await screen.findByText('Cambios guardados.')).toBeInTheDocument();
    expect(uploadSpy).toHaveBeenCalledTimes(2);
  });

  it('conserva los datos ante un corte de red y reintenta (RNF 2.2.7)', async () => {
    let attempts = 0;
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('/foto')) return new Response(null, { status: 404 });
      if (url.includes('/validaciones')) {
        return new Response(JSON.stringify({ disponible: true }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (init?.method !== 'PATCH') {
        return new Response(JSON.stringify({ terapeuta: therapist }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      attempts += 1;
      if (attempts === 1) throw new TypeError('Failed to fetch');
      return new Response(
        JSON.stringify({
          codigo: 'TERAPEUTA_ACTUALIZADO',
          terapeuta: { ...therapist, telefono: '9995554444', version: 2 },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    });
    vi.stubGlobal('fetch', fetchMock);
    renderPage();

    fireEvent.change(await screen.findByLabelText('Teléfono'), { target: { value: '9995554444' } });
    fireEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }));

    expect(await screen.findByText(/Tus datos siguen en el formulario/)).toBeInTheDocument();
    expect(screen.getByLabelText('Teléfono')).toHaveValue('9995554444');

    fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }));
    expect(await screen.findByText('Cambios guardados.')).toBeInTheDocument();
  });

  it('un conflicto de versión reaplica mis cambios y señala lo que cambió la otra persona (ADR-10)', async () => {
    let patchCalls = 0;
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('/foto')) return new Response(null, { status: 404 });
      if (url.includes('/validaciones')) {
        return new Response(JSON.stringify({ disponible: true }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (init?.method === 'PATCH') {
        patchCalls += 1;
        if (patchCalls === 1) {
          return new Response(
            JSON.stringify({ codigo: 'CONFLICTO_VERSION', mensaje: 'Conflicto', version_actual: 2 }),
            { status: 409, headers: { 'Content-Type': 'application/json' } },
          );
        }
        return new Response(
          JSON.stringify({
            codigo: 'TERAPEUTA_ACTUALIZADO',
            terapeuta: {
              ...therapist,
              telefono: '9991112222',
              correo_electronico: 'otra@correo.uady.mx',
              version: 3,
            },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      return new Response(
        JSON.stringify({
          terapeuta:
            patchCalls === 0
              ? therapist
              : { ...therapist, correo_electronico: 'otra@correo.uady.mx', version: 2 },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    });
    vi.stubGlobal('fetch', fetchMock);
    renderPage();

    fireEvent.change(await screen.findByLabelText('Teléfono'), { target: { value: '9991112222' } });
    fireEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }));

    expect(
      await screen.findByText(/Otra persona actualizó este perfil mientras lo editabas/),
    ).toBeInTheDocument();
    expect(screen.getByText(/También cambió: Correo electrónico/)).toBeInTheDocument();
    expect(screen.getByLabelText('Teléfono')).toHaveValue('9991112222');
    expect(screen.getByLabelText(/Correo electrónico/)).toHaveValue('otra@correo.uady.mx');

    fireEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }));
    expect(await screen.findByText('Cambios guardados.')).toBeInTheDocument();
    expect(patchCalls).toBe(2);
  });

  it('un conflicto sin diferencias restantes se trata como éxito (respuesta perdida)', async () => {
    let gets = 0;
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('/foto')) return new Response(null, { status: 404 });
      if (url.includes('/validaciones')) {
        return new Response(JSON.stringify({ disponible: true }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (init?.method === 'PATCH') {
        return new Response(
          JSON.stringify({ codigo: 'CONFLICTO_VERSION', mensaje: 'Conflicto', version_actual: 2 }),
          { status: 409, headers: { 'Content-Type': 'application/json' } },
        );
      }
      gets += 1;
      // La primera carga trae el perfil original; el GET de recarga tras el conflicto ya muestra
      // el cambio aplicado, porque la respuesta de aquel primer PATCH se perdió.
      return new Response(
        JSON.stringify({
          terapeuta:
            gets === 1 ? therapist : { ...therapist, telefono: '9991112222', version: 2 },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    });
    vi.stubGlobal('fetch', fetchMock);
    renderPage();

    fireEvent.change(await screen.findByLabelText('Teléfono'), { target: { value: '9991112222' } });
    fireEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }));

    expect(await screen.findByText('Cambios guardados.')).toBeInTheDocument();
    expect(patchesTo(fetchMock)).toHaveLength(1); // no se reintentó un segundo PATCH
  });

  it('la respuesta del PATCH actualiza el detalle en caché sin volver a pedirlo', async () => {
    const fetchMock = mockApi((url, init) => {
      if (url.includes('/foto')) return { status: 404, isPhoto: true };
      if (url.includes('/validaciones')) return { status: 200, body: { disponible: true } };
      if (init.method === 'PATCH') {
        return {
          status: 200,
          body: {
            codigo: 'TERAPEUTA_ACTUALIZADO',
            terapeuta: { ...therapist, telefono: '9991112222', version: 2 },
          },
        };
      }
      return { status: 200, body: { terapeuta: therapist } };
    });
    renderPage();

    fireEvent.change(await screen.findByLabelText('Teléfono'), { target: { value: '9991112222' } });
    fireEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }));
    await screen.findByText('Cambios guardados.');

    const getsAntesDeNavegar = getsAlDetalle(fetchMock).length;

    expect(await screen.findByRole('heading', { name: 'Perfil del terapeuta' })).toBeInTheDocument();
    expect(getsAlDetalle(fetchMock)).toHaveLength(getsAntesDeNavegar);
  });

  it('bloquea el cierre de sesión mientras hay cambios sin guardar', async () => {
    mockApi(sinFoto);
    renderPage();

    fireEvent.change(await screen.findByLabelText('Teléfono'), { target: { value: '9991112222' } });
    fireEvent.click(screen.getByRole('button', { name: therapist.nombre_completo }));

    const dialog = screen.getByRole('dialog', { name: '¿Salir sin guardar?' });
    expect(within(dialog).getByRole('button', { name: 'Seguir editando' })).toHaveFocus();
  });

  it('un terapeuta inactivo muestra el aviso y un enlace al perfil, sin formulario', async () => {
    mockApi((url) =>
      url.includes('/foto')
        ? { status: 404, isPhoto: true }
        : { status: 200, body: { terapeuta: { ...therapist, activo: false, fecha_baja: '2026-10-14' } } },
    );
    renderPage();

    expect(await screen.findByText('Este terapeuta está dado de baja')).toBeInTheDocument();
    expect(screen.queryByLabelText('Teléfono')).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Ir al perfil' })).toBeInTheDocument();
  });
});
