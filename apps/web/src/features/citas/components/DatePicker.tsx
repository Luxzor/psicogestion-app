import { Calendar as CalendarIcon, ChevronLeft, ChevronRight } from 'lucide-react';
import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import { esDomingo, hoyEnClinica } from '../horario';

export interface DatePickerProps {
  id?: string;
  name?: string;
  value: string; // Formato YYYY-MM-DD
  onChange: (value: string) => void;
  min?: string; // Formato YYYY-MM-DD
  max?: string; // Formato YYYY-MM-DD
  disabled?: boolean;
  disableSundays?: boolean;
  'aria-invalid'?: boolean;
  'aria-describedby'?: string;
  placeholder?: string;
  className?: string;
}

const MESES = [
  'Enero',
  'Febrero',
  'Marzo',
  'Abril',
  'Mayo',
  'Junio',
  'Julio',
  'Agosto',
  'Septiembre',
  'Octubre',
  'Noviembre',
  'Diciembre',
];

const DIAS_SEMANA = ['Do', 'Lu', 'Ma', 'Mi', 'Ju', 'Vi', 'Sá'];

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

export const DatePicker: React.FC<DatePickerProps> = ({
  id,
  name,
  value,
  onChange,
  min,
  max,
  disabled = false,
  disableSundays = true,
  'aria-invalid': ariaInvalid,
  'aria-describedby': ariaDescribedby,
  placeholder = 'aaaa-mm-dd',
  className = '',
}) => {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const containerRef = useRef<HTMLDivElement>(null);
  const [isOpen, setIsOpen] = useState(false);

  // Mes visualizado si el usuario navegó con las flechas
  const [navMonth, setNavMonth] = useState<{ year: number; month: number } | null>(null);

  const { viewYear, viewMonth } = useMemo(() => {
    if (navMonth) {
      return { viewYear: navMonth.year, viewMonth: navMonth.month };
    }
    if (value && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
      return {
        viewYear: Number(value.slice(0, 4)),
        viewMonth: Number(value.slice(5, 7)) - 1,
      };
    }
    const now = new Date();
    return { viewYear: now.getFullYear(), viewMonth: now.getMonth() };
  }, [navMonth, value]);

  // Cerrar al hacer clic fuera
  useEffect(() => {
    if (!isOpen) return;
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setIsOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen]);

  const irMesAnterior = () => {
    if (viewMonth === 0) {
      setNavMonth({ year: viewYear - 1, month: 11 });
    } else {
      setNavMonth({ year: viewYear, month: viewMonth - 1 });
    }
  };

  const irMesSiguiente = () => {
    if (viewMonth === 11) {
      setNavMonth({ year: viewYear + 1, month: 0 });
    } else {
      setNavMonth({ year: viewYear, month: viewMonth + 1 });
    }
  };

  const hoyStr = hoyEnClinica();

  // Generación de celdas para el mes actual
  const diasDelMes = useMemo(() => {
    const primerDia = new Date(viewYear, viewMonth, 1);
    const ultimoDia = new Date(viewYear, viewMonth + 1, 0);
    const primerDiaSemana = primerDia.getDay(); // 0 = Domingo
    const totalDias = ultimoDia.getDate();

    const celdas: Array<{
      key: string;
      dia?: number;
      iso?: string;
      esDomingo?: boolean;
      esPasado?: boolean;
      esFuturoMax?: boolean;
      disabled?: boolean;
    }> = [];

    // Celdas vacías al inicio para alinear con el día de la semana
    for (let i = 0; i < primerDiaSemana; i++) {
      celdas.push({ key: `vacio-prev-${i}` });
    }

    // Días del mes
    for (let dia = 1; dia <= totalDias; dia++) {
      const iso = `${viewYear}-${pad2(viewMonth + 1)}-${pad2(dia)}`;
      const esDom = disableSundays ? esDomingo(iso) : false;
      const esPasado = min ? iso < min : false;
      const esFuturoMax = max ? iso > max : false;
      const isDisabled = Boolean(disabled || esDom || esPasado || esFuturoMax);

      celdas.push({
        key: iso,
        dia,
        iso,
        esDomingo: esDom,
        esPasado,
        esFuturoMax,
        disabled: isDisabled,
      });
    }

    return celdas;
  }, [viewYear, viewMonth, disableSundays, min, max, disabled]);

  const handleDayClick = (iso: string, isDisabled?: boolean) => {
    if (isDisabled) return;
    setNavMonth(null);
    onChange(iso);
    setIsOpen(false);
  };

  return (
    <div className={`dp-container ${className}`} ref={containerRef}>
      <div className="dp-input-group">
        <input
          id={inputId}
          name={name}
          type="text"
          className="dp-input"
          value={value}
          placeholder={placeholder}
          disabled={disabled}
          aria-invalid={ariaInvalid}
          aria-describedby={ariaDescribedby}
          aria-haspopup="dialog"
          aria-expanded={isOpen}
          onClick={() => {
            if (!disabled) setIsOpen((prev) => !prev);
          }}
          onChange={(event) => {
            const nextVal = event.target.value;
            onChange(nextVal);
          }}
        />
        <button
          type="button"
          className="dp-toggle"
          aria-label="Abrir calendario"
          disabled={disabled}
          onClick={() => setIsOpen((prev) => !prev)}
        >
          <CalendarIcon size={18} aria-hidden="true" />
        </button>
      </div>

      {isOpen && (
        <div className="dp-popover" role="dialog" aria-modal="false" aria-label="Calendario de fecha">
          <div className="dp-header">
            <button
              type="button"
              className="dp-nav-btn"
              onClick={irMesAnterior}
              aria-label="Mes anterior"
            >
              <ChevronLeft size={16} aria-hidden="true" />
            </button>
            <span className="dp-title" aria-live="polite">
              {MESES[viewMonth]} {viewYear}
            </span>
            <button
              type="button"
              className="dp-nav-btn"
              onClick={irMesSiguiente}
              aria-label="Mes siguiente"
            >
              <ChevronRight size={16} aria-hidden="true" />
            </button>
          </div>

          <div className="dp-weekdays" aria-hidden="true">
            {DIAS_SEMANA.map((d, idx) => (
              <span
                key={d}
                className={`dp-weekday ${idx === 0 ? 'dp-weekday--sunday' : ''}`}
                title={idx === 0 ? 'Domingo (clínica cerrada)' : undefined}
              >
                {d}
              </span>
            ))}
          </div>

          <div className="dp-grid" role="grid">
            {diasDelMes.map((c) => {
              if (!c.dia || !c.iso) {
                return <span key={c.key} className="dp-cell dp-cell--empty" aria-hidden="true" />;
              }

              const isSelected = c.iso === value;
              const isToday = c.iso === hoyStr;

              return (
                <button
                  type="button"
                  key={c.key}
                  disabled={c.disabled}
                  aria-disabled={c.disabled}
                  tabIndex={c.disabled ? -1 : 0}
                  className={`dp-cell ${isSelected ? 'dp-cell--selected' : ''} ${
                    isToday ? 'dp-cell--today' : ''
                  } ${c.esDomingo ? 'dp-cell--sunday' : ''} ${
                    c.disabled ? 'dp-cell--disabled' : ''
                  }`}
                  title={
                    c.esDomingo
                      ? 'La clínica no abre en domingo'
                      : c.esPasado
                        ? 'Fecha en el pasado'
                        : undefined
                  }
                  onClick={() => handleDayClick(c.iso!, c.disabled)}
                  aria-label={`${c.dia} de ${MESES[viewMonth]} de ${viewYear}${
                    c.esDomingo ? ' (domingo cerrado)' : ''
                  }`}
                >
                  {c.dia}
                </button>
              );
            })}
          </div>

          {disableSundays && (
            <div className="dp-footer" aria-hidden="true">
              <span className="dp-legend">
                <span className="dp-legend-dot dp-legend-dot--sunday" />
                Domingos desactivados (clínica cerrada)
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

