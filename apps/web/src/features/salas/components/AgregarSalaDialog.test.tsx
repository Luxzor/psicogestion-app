import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { salasApi } from '../api';
import { AgregarSalaDialog } from './AgregarSalaDialog';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('AgregarSalaDialog (EDT 5.3.1, RF 4.1.1 a RF 4.1.4, CA-4.1-01 a CA-4.1-03)', () => {
  const onClose = vi.fn();
  const onCreated = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('no renderiza nada cuando isOpen es false', () => {
    render(
      <AgregarSalaDialog
        isOpen={false}
        onClose={onClose}
        onCreated={onCreated}
      />,
    );
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('muestra el formulario con campos accesibles y botón deshabilitado inicialmente (RF 4.1.2)', () => {
    render(
      <AgregarSalaDialog
        isOpen={true}
        onClose={onClose}
        onCreated={onCreated}
      />,
    );

    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Agregar sala' })).toBeInTheDocument();
    expect(
      screen.getByText('El nombre identifica a la sala en las citas. Debe ser único.'),
    ).toBeInTheDocument();

    const input = screen.getByLabelText('Nombre de la sala');
    expect(input).toHaveValue('');
    expect(input).toHaveAttribute('placeholder', 'Por ejemplo, Sala 4');

    expect(screen.getByText('0/10')).toBeInTheDocument();
    expect(screen.getByText('De 1 a 10 caracteres.')).toBeInTheDocument();

    const submitBtn = screen.getByRole('button', { name: 'Guardar sala' });
    expect(submitBtn).toBeDisabled();

    const cancelBtn = screen.getByRole('button', { name: 'Cancelar' });
    expect(cancelBtn).toBeEnabled();
  });

  it('rechaza nombres de más de 10 caracteres e indica la longitud (RF 4.1.3, CA-4.1-03)', () => {
    render(
      <AgregarSalaDialog
        isOpen={true}
        onClose={onClose}
        onCreated={onCreated}
      />,
    );

    const input = screen.getByLabelText('Nombre de la sala');
    fireEvent.change(input, { target: { value: 'Sala Grupal 1' } });

    expect(screen.getByText('13/10')).toBeInTheDocument();
    expect(
      screen.getByText('El nombre puede tener máximo 10 caracteres; tiene 13.'),
    ).toBeInTheDocument();

    const submitBtn = screen.getByRole('button', { name: 'Guardar sala' });
    expect(submitBtn).toBeDisabled();
  });

  it('verifica la unicidad anticipada y muestra error si ya existe (RF 4.1.4, CA-4.1-02, RNF 4.1.2)', async () => {
    vi.spyOn(salasApi, 'checkAvailability').mockResolvedValueOnce({
      campo: 'nombre',
      disponible: false,
      mensaje: 'Ya existe una sala con ese nombre.',
    });

    render(
      <AgregarSalaDialog
        isOpen={true}
        onClose={onClose}
        onCreated={onCreated}
      />,
    );

    const input = screen.getByLabelText('Nombre de la sala');
    fireEvent.change(input, { target: { value: 'Sala 1' } });

    await waitFor(() => {
      expect(screen.getByText('Ya existe una sala con ese nombre.')).toBeInTheDocument();
    });

    expect(screen.getByRole('button', { name: 'Guardar sala' })).toBeDisabled();
  });

  it('permite registrar la sala con datos válidos y emite evento onCreated (RF 4.1.1, CA-4.1-01)', async () => {
    vi.spyOn(salasApi, 'checkAvailability').mockResolvedValueOnce({
      campo: 'nombre',
      disponible: true,
    });

    const mockSala = {
      id: 'sala-uuid-1',
      nombre: 'Sala 4',
      activo: true,
      fecha_baja: null,
      fecha_registro: '2026-10-22',
      version: 1,
    };

    vi.spyOn(salasApi, 'register').mockResolvedValueOnce({
      codigo: 'SALA_REGISTRADA',
      sala: mockSala,
    });

    render(
      <AgregarSalaDialog
        isOpen={true}
        onClose={onClose}
        onCreated={onCreated}
        accessToken="test-token"
      />,
    );

    const input = screen.getByLabelText('Nombre de la sala');
    fireEvent.change(input, { target: { value: 'Sala 4' } });

    await waitFor(() => {
      expect(screen.getByText('Nombre disponible.')).toBeInTheDocument();
    });

    const submitBtn = screen.getByRole('button', { name: 'Guardar sala' });
    expect(submitBtn).toBeEnabled();

    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(salasApi.register).toHaveBeenCalledWith(
        { nombre: 'Sala 4' },
        'test-token',
        expect.any(String),
      );
      expect(onCreated).toHaveBeenCalledWith(mockSala);
      expect(onClose).toHaveBeenCalled();
    });
  });

  it('maneja fallas de red conservando el nombre y permitiendo reintentar (RNF 4.2.5)', async () => {
    vi.spyOn(salasApi, 'checkAvailability').mockResolvedValueOnce({
      campo: 'nombre',
      disponible: true,
    });

    vi.spyOn(salasApi, 'register').mockRejectedValueOnce(new Error('Network error'));

    render(
      <AgregarSalaDialog
        isOpen={true}
        onClose={onClose}
        onCreated={onCreated}
      />,
    );

    const input = screen.getByLabelText('Nombre de la sala');
    fireEvent.change(input, { target: { value: 'Sala 5' } });

    await waitFor(() => {
      expect(screen.getByText('Nombre disponible.')).toBeInTheDocument();
    });

    const submitBtn = screen.getByRole('button', { name: 'Guardar sala' });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(
        screen.getByText(
          'No pudimos conectar con el servidor. El nombre que escribiste se conserva; intenta guardar de nuevo.',
        ),
      ).toBeInTheDocument();
    });

    expect(input).toHaveValue('Sala 5');
    expect(screen.getByRole('button', { name: /Reintentar/i })).toBeInTheDocument();
  });

  it('permite cerrar con el botón Cancelar o tecla Escape', () => {
    render(
      <AgregarSalaDialog
        isOpen={true}
        onClose={onClose}
        onCreated={onCreated}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
    expect(onClose).toHaveBeenCalledTimes(1);

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});

