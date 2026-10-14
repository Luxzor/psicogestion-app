import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PerfilPacientePage } from './PerfilPacientePage';

type Handler = () => { status: number; body?: unknown };

const json = (status: number, body?: unknown) =>
  new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

function mockApi(handler: Handler) {
  const fetchMock = vi.fn(async () => {
    const result = handler();
    return json(result.status, result.body);
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

const patient = {
  id: '5f0b4a6e-2c1d-4b8e-9f3a-7d6c5b4a3f21',
  nombre_completo: 'Valeria Ku Escalante',
  curp: 'KUEV090825MYNXSLA3',
  sexo: 'F',
  fecha_nacimiento: '2009-08-25',
  edad: 17,
  telefono: '9996402218',
  correo: null,
  consentimiento: false,
  activo: true,
  fecha_baja: null,
  fecha_registro: '2026-10-08',
  version: 1,
  updated_at: '2026-10-08T12:00:00.000Z',
};

function renderPage(id = patient.id) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[`/inicio/pacientes/${id}`]}>
        <Routes>
          <Route path="/inicio/pacientes" element={<h1>Pacientes</h1>} />
          <Route
            path="/inicio/pacientes/:id"
            element={<PerfilPacientePage session={{ token: 'token-de-prueba' }} />}
          />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('perfil de paciente (EDT 4.3.2, RF 3.2.3)', () => {
  it('muestra nombre, fecha con edad, CURP, sexo, teléfono y "No registrado" sin correo', async () => {
    mockApi(() => ({ status: 200, body: { paciente: patient } }));
    renderPage();

    expect(
      await screen.findByRole('heading', { name: 'Valeria Ku Escalante' }),
    ).toBeInTheDocument();
    expect(screen.getByText('25/08/2009')).toBeInTheDocument();
    expect(screen.getByText('(17 años)')).toBeInTheDocument();
    expect(screen.getByText('KUEV090825MYNXSLA3')).toBeInTheDocument();
    expect(screen.getByText('Femenino')).toBeInTheDocument();
    expect(screen.getByText('9996402218')).toBeInTheDocument();
    expect(screen.getByText('No registrado')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Editar el perfil de Valeria/ })).toBeInTheDocument();
  });

  it('muestra el correo cuando el paciente lo tiene registrado', async () => {
    mockApi(() => ({
      status: 200,
      body: { paciente: { ...patient, correo: 'valeria.ku@gmail.com' } },
    }));
    renderPage();

    expect(await screen.findByText('valeria.ku@gmail.com')).toBeInTheDocument();
    expect(screen.queryByText('No registrado')).not.toBeInTheDocument();
  });

  it('un paciente inactivo muestra el aviso de baja y no ofrece "Editar"', async () => {
    mockApi(() => ({
      status: 200,
      body: { paciente: { ...patient, activo: false, fecha_baja: '2026-10-06' } },
    }));
    renderPage();

    expect(
      await screen.findByText(/Este paciente fue dado de baja el 06\/10\/2026/),
    ).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Editar/ })).not.toBeInTheDocument();
  });

  it('responde a un identificador inexistente con un mensaje claro y regreso a la lista', async () => {
    mockApi(() => ({
      status: 404,
      body: { codigo: 'PACIENTE_NO_ENCONTRADO', mensaje: 'No encontramos al paciente indicado.' },
    }));
    renderPage();

    expect(await screen.findByText('No encontramos a este paciente')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Volver a la lista' })).toBeInTheDocument();
  });
});
