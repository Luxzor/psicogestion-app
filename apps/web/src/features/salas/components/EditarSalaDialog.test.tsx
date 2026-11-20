import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { salasApi } from '../api';
import type { Sala } from '../types';
import { EditarSalaDialog } from './EditarSalaDialog';

/**
 * Edición del nombre de una sala (control de versión, ADR-23). Complementa a
 * AgregarSalaDialog.test.tsx y EliminarSalaDialog.test.tsx.
 */
const sala: Sala = {
  id: 'sala-1',
  nombre: 'Sala A',
  activo: true,
  fecha_baja: null,
  fecha_registro: '2026-10-01',
  version: 3,
};

const respuesta = (cambios: Partial<Sala> = {}) => ({
  codigo: 'SALA_ACTUALIZADA',
  sala: { ...sala, ...cambios },
});

describe('EditarSalaDialog', () => {
  const onClose = vi.fn();
  const onUpdated = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(salasApi, 'getById').mockResolvedValue({ sala } as never);
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  const abrir = () =>
    render(
      <EditarSalaDialog
        isOpen
        sala={sala}
        onClose={onClose}
        onUpdated={onUpdated}
        accessToken="t"
      />,
    );

  it('no renderiza nada si isOpen es false o no hay sala', () => {
    const { rerender } = render(<EditarSalaDialog isOpen={false} sala={sala} onClose={onClose} />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    rerender(<EditarSalaDialog isOpen sala={null} onClose={onClose} />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('precarga el nombre actual y deja Guardar deshabilitado hasta que haya un cambio', () => {
    abrir();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByLabelText(/Nombre de la sala/)).toHaveValue('Sala A');
    expect(screen.getByRole('button', { name: 'Guardar cambios' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Cancelar' })).toBeEnabled();
  });

  it('Cancelar y Escape cierran el diálogo sin llamar a la API', () => {
    abrir();
    const rename = vi.spyOn(salasApi, 'rename');
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
    expect(onClose).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(2);
    expect(rename).not.toHaveBeenCalled();
  });

  it('un nombre de más de 10 caracteres muestra la longitud y bloquea Guardar', () => {
    abrir();
    fireEvent.change(screen.getByLabelText(/Nombre de la sala/), {
      target: { value: 'Sala de juegos' },
    });
    expect(
      screen.getByText('El nombre puede tener máximo 10 caracteres; tiene 14.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Guardar cambios' })).toBeDisabled();
  });

  it('vaciar el nombre deja Guardar deshabilitado', () => {
    abrir();
    fireEvent.change(screen.getByLabelText(/Nombre de la sala/), { target: { value: '   ' } });
    expect(screen.getByRole('button', { name: 'Guardar cambios' })).toBeDisabled();
  });

  it('avisa si el nombre nuevo ya existe, excluyendo a la propia sala', async () => {
    const check = vi.spyOn(salasApi, 'checkAvailability').mockResolvedValue({
      campo: 'nombre',
      disponible: false,
      mensaje: 'Ya existe una sala con ese nombre.',
    } as never);
    abrir();
    fireEvent.change(screen.getByLabelText(/Nombre de la sala/), { target: { value: 'Sala B' } });

    expect(await screen.findByText('Ya existe una sala con ese nombre.')).toBeInTheDocument();
    expect(check).toHaveBeenCalledWith(
      { campo: 'nombre', valor: 'Sala B', excluir_id: 'sala-1' },
      't',
      expect.anything(),
    );
    expect(screen.getByRole('button', { name: 'Guardar cambios' })).toBeDisabled();
  });

  it('guarda el nombre normalizado con la versión más reciente y notifica al llamador', async () => {
    vi.spyOn(salasApi, 'getById').mockResolvedValue({ sala: { ...sala, version: 4 } } as never);
    vi.spyOn(salasApi, 'checkAvailability').mockResolvedValue({
      campo: 'nombre',
      disponible: true,
    } as never);
    const rename = vi
      .spyOn(salasApi, 'rename')
      .mockResolvedValue(respuesta({ nombre: 'Sala Uno', version: 5 }) as never);
    abrir();

    fireEvent.change(screen.getByLabelText(/Nombre de la sala/), {
      target: { value: '  Sala   Uno ' },
    });
    const guardar = screen.getByRole('button', { name: 'Guardar cambios' });
    await waitFor(() => expect(guardar).toBeEnabled());
    fireEvent.click(guardar);

    await waitFor(() => expect(rename).toHaveBeenCalledTimes(1));
    expect(rename).toHaveBeenCalledWith('sala-1', { nombre: 'Sala Uno', version: 4 }, 't');
    await waitFor(() =>
      expect(onUpdated).toHaveBeenCalledWith(expect.objectContaining({ nombre: 'Sala Uno' })),
    );
    expect(onClose).toHaveBeenCalled();
  });

  it('ante un conflicto de versión conserva el diálogo abierto y muestra el aviso', async () => {
    vi.spyOn(salasApi, 'checkAvailability').mockResolvedValue({
      campo: 'nombre',
      disponible: true,
    } as never);
    vi.spyOn(salasApi, 'rename').mockRejectedValue({
      codigo: 'CONFLICTO_VERSION',
      mensaje: 'La sala fue modificada por otro usuario.',
      status: 409,
    });
    abrir();

    fireEvent.change(screen.getByLabelText(/Nombre de la sala/), { target: { value: 'Sala Uno' } });
    const guardar = screen.getByRole('button', { name: 'Guardar cambios' });
    await waitFor(() => expect(guardar).toBeEnabled());
    fireEvent.click(guardar);

    expect(await screen.findByText('La sala fue modificada por otro usuario.')).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
    expect(onUpdated).not.toHaveBeenCalled();
  });

  it('ante una falla de red muestra Reintentar y conserva el nombre capturado', async () => {
    vi.spyOn(salasApi, 'checkAvailability').mockResolvedValue({
      campo: 'nombre',
      disponible: true,
    } as never);
    vi.spyOn(salasApi, 'rename').mockRejectedValue(new Error('Network error'));
    abrir();

    fireEvent.change(screen.getByLabelText(/Nombre de la sala/), { target: { value: 'Sala Uno' } });
    const guardar = screen.getByRole('button', { name: 'Guardar cambios' });
    await waitFor(() => expect(guardar).toBeEnabled());
    fireEvent.click(guardar);

    expect(await screen.findByRole('button', { name: /Reintentar/ })).toBeInTheDocument();
    expect(screen.getByLabelText(/Nombre de la sala/)).toHaveValue('Sala Uno');
    expect(onClose).not.toHaveBeenCalled();
  });
});
