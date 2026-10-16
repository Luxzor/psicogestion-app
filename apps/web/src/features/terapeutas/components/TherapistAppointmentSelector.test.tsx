import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  TherapistAppointmentSelector,
  type TherapistOption,
} from './TherapistAppointmentSelector';

const activeTherapist: TherapistOption = {
  id: 'terapeuta-activo-1',
  nombre_completo: 'Victoria Méndez Rosado',
  cedula_profesional: '7845213',
  activo: true,
};

const inactiveTherapist: TherapistOption = {
  id: 'terapeuta-inactivo-2',
  nombre_completo: 'Héctor Puerto Cámara',
  cedula_profesional: '6123987',
  activo: false,
};

afterEach(cleanup);

describe('Selector de terapeuta para asignación de citas (TC-F-013, CA-2.3-03, RF 2.3.5)', () => {
  it('permite seleccionar un terapeuta activo y bloquea la selección de uno inactivo (TC-F-013)', () => {
    // TC-F-013: Impedir asignación de terapeuta inactivo
    // Precondiciones: Fixture del selector de terapeuta para citas.
    // Datos de entrada: Un terapeuta activo y uno inactivo.
    // Pasos: Iniciar cita nueva y buscar/seleccionar cada terapeuta.
    // Resultado esperado: El inactivo no se ofrece o su asignación se rechaza; el activo sí puede seleccionarse.
    const onSelect = vi.fn();
    render(
      <TherapistAppointmentSelector
        therapists={[activeTherapist, inactiveTherapist]}
        onSelect={onSelect}
      />,
    );

    // 1. Verificar renderizado de opciones
    const activeBtn = screen.getByRole('button', {
      name: /Seleccionar a Victoria Méndez Rosado/i,
    });
    const inactiveBtn = screen.getByRole('button', {
      name: /Seleccionar a Héctor Puerto Cámara/i,
    });

    // 2. El terapeuta inactivo tiene indicador de dado de baja y está deshabilitado
    expect(inactiveBtn).toBeDisabled();
    expect(screen.getByText('Dado de baja')).toBeInTheDocument();

    // 3. El terapeuta activo está habilitado
    expect(activeBtn).toBeEnabled();

    // 4. Intentar hacer click en el terapeuta inactivo: no se invoca onSelect
    fireEvent.click(inactiveBtn);
    expect(onSelect).not.toHaveBeenCalled();

    // 5. Seleccionar al terapeuta activo: se invoca onSelect y se marca como seleccionado
    fireEvent.click(activeBtn);
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith(activeTherapist);
    expect(screen.getByText('Seleccionado')).toBeInTheDocument();
  });

  it('permite filtrar terapeutas por nombre o cédula', () => {
    render(
      <TherapistAppointmentSelector
        therapists={[activeTherapist, inactiveTherapist]}
      />,
    );

    const searchInput = screen.getByLabelText(/Buscar terapeuta por nombre o cédula/i);

    // Filtrar por nombre del activo
    fireEvent.change(searchInput, { target: { value: 'Victoria' } });
    expect(screen.getByText('Victoria Méndez Rosado')).toBeInTheDocument();
    expect(screen.queryByText('Héctor Puerto Cámara')).not.toBeInTheDocument();

    // Filtrar por cédula del inactivo
    fireEvent.change(searchInput, { target: { value: '6123987' } });
    expect(screen.getByText('Héctor Puerto Cámara')).toBeInTheDocument();
    expect(screen.queryByText('Victoria Méndez Rosado')).not.toBeInTheDocument();
    expect(screen.getByText('Dado de baja')).toBeInTheDocument();
  });
});
