import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { UnsavedChangesProvider } from '../../../contexts/UnsavedChangesContext';
import { PacientesPage } from './PacientesPage';
import { RegistroPacientePage } from './RegistroPacientePage';

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

const patient = {
  id: '5f0b4a6e-2c1d-4b8e-9f3a-7d6c5b4a3f21',
  nombre_completo: 'Valeria Ku Escalante',
  curp: 'KUEV090825MYNXSLA3',
  sexo: 'F',
  fecha_nacimiento: '2009-08-25',
  telefono: '9996402218',
  correo: null,
  consentimiento: false,
  activo: true,
  fecha_baja: null,
  fecha_registro: '2026-10-08',
  version: 1,
};

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/inicio/pacientes/nuevo']}>
      <UnsavedChangesProvider>
        <Routes>
          <Route path="/inicio/pacientes" element={<PacientesPage />} />
          <Route
            path="/inicio/pacientes/nuevo"
            element={<RegistroPacientePage session={{ token: 'token-de-prueba' }} />}
          />
        </Routes>
      </UnsavedChangesProvider>
    </MemoryRouter>,
  );
}

function fillValidForm() {
  fireEvent.change(screen.getByLabelText('Nombre completo'), {
    target: { value: 'Valeria Ku Escalante' },
  });
  fireEvent.change(screen.getByLabelText('CURP'), { target: { value: 'kuev090825mynxsla3' } });
  fireEvent.change(screen.getByLabelText('Sexo'), { target: { value: 'F' } });
  fireEvent.change(screen.getByLabelText('Fecha de nacimiento'), {
    target: { value: '25082009' },
  });
  fireEvent.change(screen.getByLabelText('Teléfono'), { target: { value: '999 640 2218' } });
}

const postsTo = (fetchMock: ReturnType<typeof mockApi>, suffix: string) =>
  fetchMock.mock.calls.filter(
    ([url, init]) => String(url).endsWith(suffix) && (init as RequestInit)?.method === 'POST',
  );

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('registro de paciente (EDT 4.3.1)', () => {
  it('muestra el formulario de un solo paso con los campos de la ERS', () => {
    mockApi(available);
    renderPage();

    expect(screen.getByRole('heading', { name: 'Nuevo paciente' })).toBeInTheDocument();
    for (const label of ['Nombre completo', 'CURP', 'Sexo', 'Fecha de nacimiento', 'Teléfono']) {
      expect(screen.getByLabelText(label)).toBeInTheDocument();
    }
    expect(screen.getByLabelText(/Correo electrónico/)).toBeInTheDocument();
    expect(screen.getAllByText(/\(opcional\)/)).toHaveLength(2);
    expect(screen.getByRole('button', { name: 'Guardar paciente' })).toBeEnabled();
  });

  it('no envía con campos obligatorios vacíos y lleva el foco al primero (CA-3.1-05)', async () => {
    const fetchMock = mockApi(available);
    renderPage();

    fireEvent.click(screen.getByRole('button', { name: 'Guardar paciente' }));

    expect(
      await screen.findByText('Hay 5 campos por corregir. Revisa los mensajes junto a cada campo.'),
    ).toBeInTheDocument();
    expect(screen.getByText('Escribe el nombre completo.')).toBeInTheDocument();
    expect(screen.getByText('Selecciona el sexo.')).toBeInTheDocument();
    expect(screen.getByLabelText('Nombre completo')).toHaveFocus();
    expect(screen.getByLabelText('Nombre completo')).toHaveAttribute('aria-invalid', 'true');
    expect(postsTo(fetchMock, '/api/v1/pacientes')).toHaveLength(0);
  });

  it('rechaza de inmediato una fecha de menos de 7 años (RNF 3.1.5)', () => {
    mockApi(available);
    renderPage();
    const year = new Date().getFullYear() - 3;

    fireEvent.change(screen.getByLabelText('Fecha de nacimiento'), {
      target: { value: `0101${year}` },
    });

    expect(screen.getByLabelText('Fecha de nacimiento')).toHaveValue(`01/01/${year}`);
    expect(
      screen.getByText('El paciente debe tener al menos 7 años cumplidos.'),
    ).toBeInTheDocument();
  });

  it('avisa de un CURP ya registrado con la verificación anticipada (CA-3.1-03)', async () => {
    const fetchMock = mockApi((url, init) => {
      if (url.endsWith('/validaciones')) {
        const body = JSON.parse(String(init.body)) as { campo: string };
        return body.campo === 'curp'
          ? {
              status: 200,
              body: { campo: 'curp', disponible: false, mensaje: 'Este CURP ya está registrado.' },
            }
          : { status: 200, body: { campo: 'telefono', disponible: true } };
      }
      return { status: 500 };
    });
    renderPage();

    fireEvent.change(screen.getByLabelText('CURP'), { target: { value: 'KUEV090825MYNXSLA3' } });

    expect(
      await screen.findByText('Este CURP ya está registrado.', {}, { timeout: 2000 }),
    ).toBeInTheDocument();
    const [, init] = postsTo(fetchMock, '/validaciones')[0];
    expect(JSON.parse(String(init?.body))).toEqual({
      campo: 'curp',
      valor: 'KUEV090825MYNXSLA3',
    });
    expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer token-de-prueba');
  });

  it('guarda al paciente y confirma el registro (CA-3.1-01)', async () => {
    const fetchMock = mockApi((url) =>
      url.endsWith('/validaciones')
        ? { status: 200, body: { disponible: true } }
        : { status: 201, body: { codigo: 'PACIENTE_REGISTRADO', paciente: patient } },
    );
    renderPage();
    fillValidForm();

    fireEvent.click(screen.getByRole('button', { name: 'Guardar paciente' }));

    expect(await screen.findByText('Paciente registrado.')).toBeInTheDocument();
    const [[, init]] = postsTo(fetchMock, '/api/v1/pacientes');
    expect(JSON.parse(String(init?.body))).toEqual({
      nombre_completo: 'Valeria Ku Escalante',
      curp: 'KUEV090825MYNXSLA3',
      sexo: 'F',
      fecha_nacimiento: '2009-08-25',
      telefono: '9996402218',
      correo: null,
      consentimiento: false,
    });
    expect(new Headers(init?.headers).get('Idempotency-Key')).toBeTruthy();
  });

  it('conserva los datos ante una falla de red y reintenta con la misma llave (RNF 3.2.6)', async () => {
    let attempts = 0;
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/validaciones') || !init) return json(200, { disponible: true });
      attempts += 1;
      if (attempts === 1) throw new TypeError('Failed to fetch');
      return json(201, { codigo: 'PACIENTE_REGISTRADO', paciente: patient });
    });
    vi.stubGlobal('fetch', fetchMock);
    renderPage();
    fillValidForm();

    fireEvent.click(screen.getByRole('button', { name: 'Guardar paciente' }));

    expect(await screen.findByText(/Tus datos siguen en el formulario/)).toBeInTheDocument();
    expect(screen.getByLabelText('Nombre completo')).toHaveValue('Valeria Ku Escalante');

    fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }));

    expect(await screen.findByText('Paciente registrado.')).toBeInTheDocument();
    const keys = fetchMock.mock.calls
      .filter(([url]) => String(url).endsWith('/api/v1/pacientes'))
      .map(([, init]) => new Headers(init?.headers).get('Idempotency-Key'));
    expect(keys).toHaveLength(2);
    expect(keys[0]).toBe(keys[1]);
  });

  it('muestra junto a cada campo los duplicados que detecta el servidor', async () => {
    mockApi((url) =>
      url.endsWith('/validaciones')
        ? { status: 200, body: { disponible: true } }
        : {
            status: 409,
            body: {
              codigo: 'TELEFONO_EN_USO',
              mensaje: 'El teléfono ya está registrado en otro paciente.',
              campos: { telefono: 'Este teléfono ya está registrado en otro paciente.' },
            },
          },
    );
    renderPage();
    fillValidForm();

    fireEvent.click(screen.getByRole('button', { name: 'Guardar paciente' }));

    expect(
      await screen.findByText('Este teléfono ya está registrado en otro paciente.'),
    ).toBeInTheDocument();
    expect(screen.getByText(/Hay 1 campo por corregir/)).toBeInTheDocument();
    expect(screen.getByLabelText('Teléfono')).toHaveFocus();
  });

  it('ofrece reactivar a un paciente dado de baja con el mismo CURP', async () => {
    const fetchMock = mockApi((url) => {
      if (url.endsWith('/validaciones')) return { status: 200, body: { disponible: true } };
      if (url.endsWith('/reactivacion')) {
        return { status: 200, body: { codigo: 'PACIENTE_REACTIVADO', paciente: patient } };
      }
      return {
        status: 409,
        body: {
          codigo: 'PACIENTE_DADO_DE_BAJA',
          mensaje: 'Este CURP pertenece a un paciente dado de baja.',
          paciente: {
            id: patient.id,
            nombre_completo: 'Rosa María Cauich Euán',
            fecha_baja: '2026-10-06',
          },
        },
      };
    });
    renderPage();
    fillValidForm();

    fireEvent.click(screen.getByRole('button', { name: 'Guardar paciente' }));

    const dialog = await screen.findByRole('alertdialog', {
      name: 'Este CURP pertenece a un paciente dado de baja',
    });
    expect(dialog).toHaveTextContent('Rosa María Cauich Euán');
    expect(dialog).toHaveTextContent('dado de baja el 06/10/2026');
    expect(within(dialog).getByRole('button', { name: 'Cancelar' })).toHaveFocus();

    fireEvent.click(within(dialog).getByRole('button', { name: 'Reactivar' }));

    expect(await screen.findByText('Paciente reactivado.')).toBeInTheDocument();
    expect(postsTo(fetchMock, `/pacientes/${patient.id}/reactivacion`)).toHaveLength(1);
  });

  it('pide confirmación antes de salir con datos capturados', async () => {
    mockApi(available);
    renderPage();
    fireEvent.change(screen.getByLabelText('Nombre completo'), { target: { value: 'Gael' } });

    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));

    expect(screen.getByRole('dialog', { name: '¿Salir sin guardar?' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Seguir editando' })).toHaveFocus();

    fireEvent.click(screen.getByRole('button', { name: 'Salir sin guardar' }));

    await waitFor(() =>
      expect(screen.getByRole('heading', { name: 'Pacientes' })).toBeInTheDocument(),
    );
  });
});
