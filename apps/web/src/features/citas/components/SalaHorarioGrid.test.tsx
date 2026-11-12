import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { salasApi } from '../../salas/api';
import type { BloqueEstado, DisponibilidadSala } from '../../salas/types';
import { SalaHorarioGrid, type SalaHorarioValue } from './SalaHorarioGrid';

/**
 * RF 5.1.3–5.1.4, RNF 5.1.1. Rejilla de sala y horario de "Agendar cita": estados por ventana,
 * duración, selección y limpieza del horario cuando deja de ser válido.
 */
const FECHA = '2027-03-01'; // lunes
/** 07:00 en Mérida son las 13:00 UTC. */
const bloque = (indice: number, estado: BloqueEstado = 'libre') => {
  const minutos = 7 * 60 + indice * 30;
  const hh = String(Math.floor(minutos / 60) + 6).padStart(2, '0');
  const mm = String(minutos % 60).padStart(2, '0');
  return { inicio: `${FECHA}T${hh}:${mm}:00.000Z`, estado };
};

const bloques = (cambios: Record<number, BloqueEstado> = {}) =>
  Array.from({ length: 20 }, (_, i) => bloque(i, cambios[i] ?? 'libre'));

const salaA = (cambios: Record<number, BloqueEstado> = {}): DisponibilidadSala => ({
  id: 'sala-a',
  nombre: 'Sala A',
  bloques: bloques(cambios),
});
const salaB = (cambios: Record<number, BloqueEstado> = {}): DisponibilidadSala => ({
  id: 'sala-b',
  nombre: 'Sala B',
  bloques: bloques(cambios),
});

const vacia: SalaHorarioValue = { salaId: '', inicio: null };
/** Un instante anterior a todos los bloques del día, para que ninguno esté "pasado". */
const ANTES = new Date('2027-02-28T12:00:00Z');

describe('SalaHorarioGrid', () => {
  const onChange = vi.fn();
  const onDuracionChange = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  function montar(
    salas: DisponibilidadSala[] | 'error' | 'pendiente',
    props: Partial<Parameters<typeof SalaHorarioGrid>[0]> = {},
  ) {
    const getDisponibilidad = vi.spyOn(salasApi, 'getDisponibilidad');
    if (salas === 'error') getDisponibilidad.mockRejectedValue(new Error('fallo'));
    else if (salas === 'pendiente') getDisponibilidad.mockReturnValue(new Promise(() => {}));
    else getDisponibilidad.mockResolvedValue({ fecha: FECHA, bloques: [], salas } as never);

    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const view = render(
      <QueryClientProvider client={queryClient}>
        <SalaHorarioGrid
          fecha={FECHA}
          fechaValida
          duracion={60}
          onDuracionChange={onDuracionChange}
          value={vacia}
          onChange={onChange}
          accessToken="t"
          ahora={ANTES}
          {...props}
        />
      </QueryClientProvider>,
    );
    return { ...view, getDisponibilidad };
  }

  it('muestra las cuatro duraciones, marca la elegida y avisa al cambiar', async () => {
    montar([salaA()]);
    for (const etiqueta of ['30 min', '1 h', '1 h 30 min', '2 h']) {
      expect(screen.getByRole('button', { name: etiqueta })).toBeInTheDocument();
    }
    expect(screen.getByRole('button', { name: '1 h' })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByRole('button', { name: '2 h' }));
    expect(onDuracionChange).toHaveBeenCalledWith(120);
    await screen.findByText('Sala A');
  });

  it('pide la disponibilidad con la fecha, el paciente, el terapeuta y los bloques de la duración', async () => {
    const { getDisponibilidad } = montar([salaA()], {
      idPaciente: 'pac-1',
      idTerapeuta: 'ter-1',
      duracion: 90,
    });
    await screen.findByText('Sala A');
    expect(getDisponibilidad).toHaveBeenCalledWith(
      { fecha: FECHA, id_paciente: 'pac-1', id_terapeuta: 'ter-1', duracion: 3 },
      't',
      expect.anything(),
    );
  });

  it('en domingo explica que la clínica no abre y no muestra salas ni horarios', async () => {
    montar([salaA()], { fecha: '2027-03-07' });
    expect(
      screen.getByText('La clínica no abre los domingos. Elige un día de lunes a sábado.'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('listbox', { name: 'Horarios de inicio' })).not.toBeInTheDocument();
    expect(screen.queryByText('Sala A')).not.toBeInTheDocument();
  });

  it('con fecha inválida pide elegir una y no consulta', () => {
    const { getDisponibilidad } = montar([salaA()], { fechaValida: false });
    expect(screen.getByText('Elige una fecha válida para ver los horarios.')).toBeInTheDocument();
    expect(getDisponibilidad).not.toHaveBeenCalled();
  });

  it('muestra el estado de carga mientras consulta', () => {
    montar('pendiente');
    expect(screen.getByText('Consultando disponibilidad...')).toBeInTheDocument();
  });

  it('ante un error ofrece Reintentar y vuelve a consultar', async () => {
    const { getDisponibilidad } = montar('error');
    expect(await screen.findByText('No pudimos consultar la disponibilidad.')).toBeInTheDocument();
    getDisponibilidad.mockResolvedValue({ fecha: FECHA, bloques: [], salas: [salaA()] } as never);
    fireEvent.click(screen.getByRole('button', { name: /Reintentar/ }));
    expect(await screen.findByText('Sala A')).toBeInTheDocument();
  });

  it('avisa cuando no hay salas activas', async () => {
    montar([]);
    expect(await screen.findByText(/No hay salas activas registradas/)).toBeInTheDocument();
  });

  it('muestra las salas con el conteo de inicios libres y deshabilita la que no tiene', async () => {
    const todasOcupadas = Object.fromEntries(
      Array.from({ length: 20 }, (_, i) => [i, 'reservada' as BloqueEstado]),
    );
    montar([salaA(), salaB(todasOcupadas)]);

    const a = await screen.findByRole('button', { name: /Sala A/ });
    const b = screen.getByRole('button', { name: /Sala B/ });
    // 1 h = 2 bloques: de 20 inicios, el último no cabe, quedan 19.
    expect(a).toHaveTextContent('19 libres');
    expect(b).toHaveTextContent('Sin horarios');
    expect(b).toBeDisabled();
  });

  it('al elegir una sala informa su id y su nombre y limpia el inicio', async () => {
    montar([salaA(), salaB()]);
    fireEvent.click(await screen.findByRole('button', { name: /Sala B/ }));
    expect(onChange).toHaveBeenCalledWith({ salaId: 'sala-b', salaNombre: 'Sala B', inicio: null });
  });

  it('sin sala elegida pide elegir una; con sala elegida lista los 20 horarios', async () => {
    const { rerender } = montar([salaA()]);
    expect(
      await screen.findByText(/Elige una sala para ver sus horarios libres/),
    ).toBeInTheDocument();
    expect(screen.queryByRole('listbox', { name: 'Horarios de inicio' })).not.toBeInTheDocument();
    rerender(<></>);
  });

  it('con sala elegida lista los 20 horarios de 07:00 a 16:30', async () => {
    montar([salaA()], { value: { salaId: 'sala-a', salaNombre: 'Sala A', inicio: null } });
    const opciones = await screen.findAllByRole('option');
    expect(opciones).toHaveLength(20);
    expect(opciones[0]).toHaveTextContent('07:00');
    expect(opciones[19]).toHaveTextContent('16:30');
  });

  it('una ventana que choca con un bloque ocupado queda deshabilitada y la anterior sigue libre', async () => {
    // 09:30 (índice 5) ocupado: con 1 h, el inicio 09:00 (índice 4) choca; 08:30 (índice 3) cabe.
    montar([salaA({ 5: 'reservada' })], {
      value: { salaId: 'sala-a', salaNombre: 'Sala A', inicio: null },
    });
    const opciones = await screen.findAllByRole('option');
    expect(opciones[3]).toBeEnabled(); // 08:30 → 08:30 y 09:00
    expect(opciones[4]).toBeDisabled(); // 09:00 → 09:00 y 09:30 (ocupado)
    expect(opciones[4]).toHaveTextContent('Ocupada');
    expect(opciones[5]).toBeDisabled(); // 09:30 mismo
  });

  it('con 30 min el mismo bloque anterior sí queda libre', async () => {
    montar([salaA({ 5: 'reservada' })], {
      duracion: 30,
      value: { salaId: 'sala-a', salaNombre: 'Sala A', inicio: null },
    });
    const opciones = await screen.findAllByRole('option');
    expect(opciones[4]).toBeEnabled();
    expect(opciones[5]).toBeDisabled();
  });

  it('el último inicio no cabe cuando la sesión excede el horario de la clínica', async () => {
    montar([salaA()], { value: { salaId: 'sala-a', salaNombre: 'Sala A', inicio: null } });
    const opciones = await screen.findAllByRole('option');
    expect(opciones[19]).toBeDisabled();
    expect(opciones[19]).toHaveTextContent('No cabe');
  });

  it('un bloque no disponible (terapeuta o paciente) se muestra como tal', async () => {
    montar([salaA({ 2: 'no_disponible' })], {
      duracion: 30,
      value: { salaId: 'sala-a', salaNombre: 'Sala A', inicio: null },
    });
    const opciones = await screen.findAllByRole('option');
    expect(opciones[2]).toBeDisabled();
    expect(opciones[2]).toHaveTextContent('No disponible');
  });

  it('los horarios que ya pasaron aparecen como Pasado y no se pueden elegir', async () => {
    // Mediodía de Mérida del mismo día: los bloques antes de las 12:00 ya pasaron.
    montar([salaA()], {
      duracion: 30,
      ahora: new Date('2027-03-01T18:00:00Z'),
      value: { salaId: 'sala-a', salaNombre: 'Sala A', inicio: null },
    });
    const opciones = await screen.findAllByRole('option');
    expect(opciones[0]).toBeDisabled();
    expect(opciones[0]).toHaveTextContent('Pasado');
    expect(opciones[19]).toBeEnabled();
  });

  it('al elegir un horario libre informa los minutos de inicio', async () => {
    montar([salaA()], { value: { salaId: 'sala-a', salaNombre: 'Sala A', inicio: null } });
    const opciones = await screen.findAllByRole('option');
    fireEvent.click(opciones[4]); // 09:00
    expect(onChange).toHaveBeenCalledWith({ salaId: 'sala-a', salaNombre: 'Sala A', inicio: 540 });
  });

  it('el horario seleccionado muestra su hora de término', async () => {
    montar([salaA()], { value: { salaId: 'sala-a', salaNombre: 'Sala A', inicio: 540 } });
    const opciones = await screen.findAllByRole('option');
    expect(opciones[4]).toHaveAttribute('aria-selected', 'true');
    expect(opciones[4]).toHaveTextContent('a 10:00');
  });

  it('si el horario elegido deja de ser válido, limpia solo el inicio', async () => {
    // 09:00 seleccionado, pero el bloque 09:30 llega ocupado: la ventana de 1 h ya no cabe.
    montar([salaA({ 5: 'reservada' })], {
      value: { salaId: 'sala-a', salaNombre: 'Sala A', inicio: 540 },
    });
    await waitFor(() =>
      expect(onChange).toHaveBeenCalledWith({
        salaId: 'sala-a',
        salaNombre: 'Sala A',
        inicio: null,
      }),
    );
  });

  it('muestra el mensaje de error recibido', async () => {
    montar([salaA()], { error: 'Elige un horario de inicio.' });
    expect(await screen.findByText('Elige un horario de inicio.')).toBeInTheDocument();
  });
});
