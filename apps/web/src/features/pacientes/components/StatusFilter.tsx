import type { PatientListState } from '../types';

const OPTIONS: { value: PatientListState; label: string }[] = [
  { value: 'activos', label: 'Activos' },
  { value: 'inactivos', label: 'Dados de baja' },
];

/**
 * EDT 4.3.3. Filtro "Mostrar: Activos o Dados de baja" de la lista (StatusFilter de
 * PG-DSN-002-INT, TP2-06). Es un grupo de botones con aria-pressed: el estado elegido se anuncia
 * con texto, no solo con el color.
 */
export function StatusFilter({
  value,
  onChange,
  label,
}: {
  value: PatientListState;
  onChange: (value: PatientListState) => void;
  label: string;
}) {
  return (
    <div className="segmented" role="group" aria-label={label}>
      <span className="segmented__label" aria-hidden="true">
        Mostrar:
      </span>
      {OPTIONS.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={value === option.value}
          onClick={() => {
            if (value !== option.value) onChange(option.value);
          }}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
