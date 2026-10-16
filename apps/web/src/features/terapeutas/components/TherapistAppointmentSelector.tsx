import { useState, useId } from 'react';
import { AlertCircle, Check, Search, UserX } from 'lucide-react';
import { isTherapistEligibleForAppointment } from '../validation';

export type TherapistOption = {
  id: string;
  nombre_completo: string;
  cedula_profesional?: string;
  activo: boolean;
};

export type TherapistAppointmentSelectorProps = {
  therapists: TherapistOption[];
  selectedId?: string | null;
  onSelect?: (therapist: TherapistOption) => void;
  label?: string;
};

/**
 * RF 2.3.5, CA-2.3-03, TC-F-013.
 * Componente / fixture para la selección y asignación de terapeutas a citas nuevas.
 * Impide la selección de terapeutas inactivos o dados de baja.
 */
export function TherapistAppointmentSelector({
  therapists,
  selectedId: controlledSelectedId,
  onSelect,
  label = 'Seleccionar terapeuta para cita',
}: TherapistAppointmentSelectorProps) {
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(controlledSelectedId ?? null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const searchInputId = useId();

  const filteredTherapists = therapists.filter((t) => {
    const q = query.trim().toLowerCase();
    if (!q) return true;
    return (
      t.nombre_completo.toLowerCase().includes(q) ||
      Boolean(t.cedula_profesional && t.cedula_profesional.toLowerCase().includes(q))
    );
  });

  const handleSelect = (therapist: TherapistOption) => {
    if (!isTherapistEligibleForAppointment(therapist)) {
      setErrorMessage(
        `El terapeuta ${therapist.nombre_completo} está dado de baja y no puede asignarse a una cita nueva.`,
      );
      return;
    }
    setErrorMessage(null);
    setSelectedId(therapist.id);
    onSelect?.(therapist);
  };

  return (
    <div className="therapist-selector" data-testid="therapist-appointment-selector">
      <label htmlFor={searchInputId} className="therapist-selector__label">
        {label}
      </label>

      <div className="search therapist-selector__search">
        <Search size={16} aria-hidden="true" />
        <input
          id={searchInputId}
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Buscar terapeuta por nombre o cédula..."
          aria-label="Buscar terapeuta por nombre o cédula"
        />
      </div>

      {errorMessage && (
        <div role="alert" className="alert alert--error therapist-selector__alert">
          <AlertCircle size={16} aria-hidden="true" />
          <span>{errorMessage}</span>
        </div>
      )}

      <ul className="therapist-selector__list" role="listbox" aria-label="Terapeutas disponibles">
        {filteredTherapists.map((therapist) => {
          const isEligible = isTherapistEligibleForAppointment(therapist);
          const isSelected = selectedId === therapist.id;

          return (
            <li
              key={therapist.id}
              role="option"
              aria-selected={isSelected}
              aria-disabled={!isEligible}
              className={`therapist-selector__item ${
                !isEligible ? 'therapist-selector__item--inactive' : ''
              } ${isSelected ? 'therapist-selector__item--selected' : ''}`}
            >
              <button
                type="button"
                disabled={!isEligible}
                onClick={() => handleSelect(therapist)}
                className="therapist-selector__button"
                aria-label={`Seleccionar a ${therapist.nombre_completo}${
                  !isEligible ? ' (Inactivo - No disponible)' : ''
                }`}
              >
                <div className="therapist-selector__info">
                  <span className="therapist-selector__name">{therapist.nombre_completo}</span>
                  {therapist.cedula_profesional && (
                    <span className="therapist-selector__cedula">
                      Cédula: {therapist.cedula_profesional}
                    </span>
                  )}
                </div>

                {!isEligible ? (
                  <span className="badge badge--danger therapist-selector__badge">
                    <UserX size={12} aria-hidden="true" />
                    Dado de baja
                  </span>
                ) : isSelected ? (
                  <span className="badge badge--success therapist-selector__badge">
                    <Check size={12} aria-hidden="true" />
                    Seleccionado
                  </span>
                ) : null}
              </button>
            </li>
          );
        })}
        {filteredTherapists.length === 0 && (
          <li className="therapist-selector__empty">No se encontraron terapeutas.</li>
        )}
      </ul>
    </div>
  );
}

