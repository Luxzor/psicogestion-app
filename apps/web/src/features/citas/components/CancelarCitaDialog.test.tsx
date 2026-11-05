import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CancelarCitaDialog } from './CancelarCitaDialog';
import type { Cita } from '../types';

const json = (status: number, body?: unknown) =>
  new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

const citaPrueba: Cita = {
  id: '11111111-1111-4111-8111-111111111111',
  folio: 'C26000001',
  estado: 'Pendiente',
  inicio: '2026-11-09T15:00:00.000Z',
  fin: '2026-11-09T15:30:00.000Z',
  duracion_bloques: 1,
  paciente: { id: 'pac-1', nombre_completo: 'Valeria Ku Escalante' },
  terapeuta: { id: 'ter-1', nombre_completo: 'Victoria Méndez Rosado' },
  sala: { id: 'sala-1', nombre: 'Sala A' },
  cancelada_en: null,
  fecha_registro: '2026-10-01',
  version: 1,
};

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('CancelarCitaDialog (EDT 5.3.5)', () => {
  it('renderiza los datos de la cita y la advertencia de liberación de horario', () => {
    render(
      <CancelarCitaDialog
        isOpen={true}
        cita={citaPrueba}
        onClose={vi.fn()}
        accessToken="test-token"
      />,
    );

    expect(screen.getByRole('alertdialog')).toBeInTheDocument();
    expect(screen.getByText('¿Cancelar la cita C26000001?')).toBeInTheDocument();
    expect(screen.getByText('Valeria Ku Escalante')).toBeInTheDocument();
    expect(screen.getByText('Victoria Méndez Rosado')).toBeInTheDocument();
    expect(screen.getByText('Sala A')).toBeInTheDocument();
    expect(
      screen.getByText(
        /El horario quedará libre para nuevas citas\. La cita se conserva en el histórico con estatus Cancelada\./,
      ),
    ).toBeInTheDocument();
  });

  it('cierra el diálogo al pulsar Volver sin llamar al endpoint', () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const onClose = vi.fn();

    render(
      <CancelarCitaDialog
        isOpen={true}
        cita={citaPrueba}
        onClose={onClose}
        accessToken="test-token"
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Volver' }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('cancela la cita exitosamente llamando a POST /citas/:id/cancelar con version', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      json(200, {
        cita: { ...citaPrueba, estado: 'Cancelada', version: 2 },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const onCanceled = vi.fn();
    const onClose = vi.fn();

    render(
      <CancelarCitaDialog
        isOpen={true}
        cita={citaPrueba}
        onClose={onClose}
        onCanceled={onCanceled}
        accessToken="test-token"
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Cancelar cita' }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain(`/api/v1/citas/${citaPrueba.id}/cancelar`);
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({ version: 1 });
    expect(onCanceled).toHaveBeenCalledWith(
      expect.objectContaining({ id: citaPrueba.id, estado: 'Cancelada' }),
    );
    expect(onClose).toHaveBeenCalled();
  });

  it('muestra aviso de error de conexión y permite reintentar sin cerrar el diálogo', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error('Network error'));
    vi.stubGlobal('fetch', fetchMock);
    const onClose = vi.fn();

    render(
      <CancelarCitaDialog
        isOpen={true}
        cita={citaPrueba}
        onClose={onClose}
        accessToken="test-token"
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Cancelar cita' }));

    expect(
      await screen.findByText(
        'No pudimos cancelar la cita por un error de conexión. La cita no cambió; intenta de nuevo.',
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reintentar' })).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('muestra mensaje amigable ante error de conflicto de versión (409)', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      json(409, {
        codigo: 'CONFLICTO_VERSION',
        mensaje: 'La cita fue modificada por otro usuario.',
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    render(
      <CancelarCitaDialog
        isOpen={true}
        cita={citaPrueba}
        onClose={vi.fn()}
        accessToken="test-token"
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Cancelar cita' }));

    expect(
      await screen.findByText(/Otra persona modificó esta cita/i),
    ).toBeInTheDocument();
  });

  it('obtiene la versión mediante getById si la cita del listado no incluye version', async () => {
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (url.includes('/api/v1/citas/11111111-1111-4111-8111-111111111111/cancelar')) {
        return Promise.resolve(
          json(200, { codigo: 'CITA_CANCELADA', cita: { ...citaPrueba, version: 2 } }),
        );
      }
      if (url.includes('/api/v1/citas/11111111-1111-4111-8111-111111111111')) {
        return Promise.resolve(json(200, { cita: { ...citaPrueba, version: 1 } }));
      }
      return Promise.reject(new Error('Unknown url'));
    });
    vi.stubGlobal('fetch', fetchMock);

    const onCanceled = vi.fn();
    const onClose = vi.fn();
    const citaSinVersion = { ...citaPrueba } as Partial<Cita>;
    delete citaSinVersion.version;

    render(
      <CancelarCitaDialog
        isOpen={true}
        cita={citaSinVersion as Cita}
        onClose={onClose}
        onCanceled={onCanceled}
        accessToken="test-token"
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Cancelar cita' }));

    await waitFor(() => expect(onCanceled).toHaveBeenCalled());
    expect(onClose).toHaveBeenCalled();
  });
});
