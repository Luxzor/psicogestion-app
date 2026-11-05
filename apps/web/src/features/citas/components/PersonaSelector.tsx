import { useEffect, useRef, useState } from 'react';
import { LoaderCircle, Search, UserRound, X } from 'lucide-react';
import { usePatientList } from '../../pacientes/hooks/usePacientes';
import { useTherapistList } from '../../terapeutas/hooks/useTerapeutas';

const SEARCH_DELAY_MS = 300;
const PAGE_SIZE = 20;

export type PersonaOption = {
  id: string;
  nombre_completo: string;
  /** Siempre true: el servidor solo devuelve activos (estado=activos por omisión). */
  activo: boolean;
  /** Cédula del terapeuta, para distinguir homónimos. */
  sub?: string;
};

type PersonaSelectorProps = {
  id: string;
  tipo: 'paciente' | 'terapeuta';
  label: string;
  placeholder: string;
  hint?: string;
  error?: string;
  value: PersonaOption | null;
  onChange: (value: PersonaOption | null) => void;
  onBlur?: () => void;
  accessToken: string;
  disabled?: boolean;
};

/**
 * EDT 5.3.3. Selector de paciente o terapeuta con búsqueda en vivo (PG-DSN-003-INT, combo de
 * "Agendar cita"). Consulta GET /pacientes?estado=activos&q= o GET /terapeutas?estado=activos&q=
 * (por omisión del servidor; aquí no se pide `estado=inactivos`) con una pausa de 300 ms, así
 * que un terapeuta o paciente dado de baja nunca aparece en la lista (RF 2.3.5, CA-5.1-03).
 */
export function PersonaSelector({
  id,
  tipo,
  label,
  placeholder,
  hint,
  error,
  value,
  onChange,
  onBlur,
  accessToken,
  disabled,
}: PersonaSelectorProps) {
  const listId = `${id}-list`;
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const statusId = `${id}-status`;
  const singular = tipo === 'paciente' ? 'paciente' : 'terapeuta';

  // Mientras el combo está cerrado, el campo muestra el nombre del valor elegido (si hay uno);
  // mientras está abierto, muestra lo que la persona está escribiendo. Es un valor derivado, no
  // un estado sincronizado con un efecto, para no duplicar la fuente de verdad.
  const [draft, setDraft] = useState('');
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const boxRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const texto = open ? draft : (value?.nombre_completo ?? '');

  useEffect(() => {
    if (!open) return;
    const timer = setTimeout(() => setQuery(draft.trim()), SEARCH_DELAY_MS);
    return () => clearTimeout(timer);
  }, [draft, open]);

  useEffect(() => {
    if (!open) return;
    function onClickOutside(event: MouseEvent) {
      if (!boxRef.current?.contains(event.target as Node)) setOpen(false);
    }
    window.addEventListener('mousedown', onClickOutside);
    return () => window.removeEventListener('mousedown', onClickOutside);
  }, [open]);

  const patientList = usePatientList(
    { pagina: 1, tamano: PAGE_SIZE, q: query || undefined },
    accessToken,
  );
  const therapistList = useTherapistList(
    { pagina: 1, tamano: PAGE_SIZE, q: query || undefined },
    accessToken,
  );

  const loading = tipo === 'paciente' ? patientList.isFetching : therapistList.isFetching;
  const failed = tipo === 'paciente' ? patientList.isError : therapistList.isError;
  const options: PersonaOption[] =
    tipo === 'paciente'
      ? (patientList.data?.datos ?? []).map((p) => ({
          id: p.id,
          nombre_completo: p.nombre_completo,
          activo: true,
        }))
      : (therapistList.data?.datos ?? []).map((t) => ({
          id: t.id,
          nombre_completo: t.nombre_completo,
          activo: true,
          sub: t.cedula_profesional,
        }));

  function abrir() {
    if (disabled) return;
    if (!open) {
      setDraft(value?.nombre_completo ?? '');
      setQuery('');
    }
    setOpen(true);
    setActiveIndex(options.findIndex((o) => o.id === value?.id));
  }

  function elegir(option: PersonaOption) {
    onChange(option);
    setOpen(false);
    inputRef.current?.focus();
  }

  function limpiar() {
    onChange(null);
    setDraft('');
    setQuery('');
    inputRef.current?.focus();
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      if (!open) {
        abrir();
        return;
      }
      setActiveIndex((index) => Math.min(index + 1, options.length - 1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      if (!open) {
        abrir();
        return;
      }
      setActiveIndex((index) => Math.max(index - 1, 0));
    } else if (event.key === 'Enter') {
      if (open && activeIndex >= 0 && options[activeIndex]) {
        event.preventDefault();
        elegir(options[activeIndex]);
      }
    } else if (event.key === 'Escape') {
      if (open) {
        event.preventDefault();
        event.stopPropagation();
        setOpen(false);
      }
    } else if (event.key === 'Tab') {
      setOpen(false);
    }
  }

  const statusText = !open
    ? ''
    : loading
      ? 'Buscando...'
      : failed
        ? 'No pudimos cargar la lista. Revisa tu conexión.'
        : options.length === 0
          ? query
            ? `No encontramos ningún ${singular} con "${query}".`
            : `No hay ${tipo === 'paciente' ? 'pacientes' : 'terapeutas'} activos registrados.`
          : `${options.length} ${options.length === 1 ? singular : `${singular}s`}${query ? ` con "${query}"` : ''}`;

  return (
    <div className="field persona-selector" data-f={id} ref={boxRef}>
      <label htmlFor={id}>{label}</label>
      <div className={`combo${open ? ' is-open' : ''}${value ? ' has-value' : ''}`}>
        <span className="combo__icon" aria-hidden="true">
          <Search size={15} />
        </span>
        <input
          ref={inputRef}
          id={id}
          type="text"
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={open && activeIndex >= 0 ? `${id}-o${activeIndex}` : undefined}
          aria-describedby={`${hintId} ${errorId}`}
          aria-invalid={Boolean(error)}
          autoComplete="off"
          spellCheck={false}
          placeholder={placeholder}
          value={texto}
          disabled={disabled}
          onFocus={abrir}
          onClick={abrir}
          onChange={(event) => {
            setOpen(true);
            setDraft(event.target.value);
          }}
          onKeyDown={onKeyDown}
          onBlur={() => {
            window.setTimeout(() => {
              if (!boxRef.current?.contains(document.activeElement)) {
                setOpen(false);
                onBlur?.();
              }
            }, 0);
          }}
        />
        {value ? (
          <button
            type="button"
            className="combo__clear"
            aria-label={`Quitar ${label.toLowerCase()}`}
            disabled={disabled}
            onClick={limpiar}
          >
            <X size={14} aria-hidden="true" />
          </button>
        ) : null}

        {open ? (
          <div className="combo__pop">
            <p className="combo__count" id={statusId} aria-live="polite">
              {statusText}
            </p>
            <ul className="combo__list" id={listId} role="listbox" aria-label={`${label}s`}>
              {loading && options.length === 0 ? (
                <li className="combo__none" role="presentation">
                  <LoaderCircle size={16} className="spin" aria-hidden="true" />
                  <span>Buscando...</span>
                </li>
              ) : options.length === 0 ? (
                <li className="combo__none" role="presentation">
                  <UserRound size={16} aria-hidden="true" />
                  <span>{statusText}</span>
                </li>
              ) : (
                options.map((option, index) => (
                  <li
                    key={option.id}
                    id={`${id}-o${index}`}
                    role="option"
                    aria-selected={value?.id === option.id}
                    className={`combo__opt${index === activeIndex ? ' is-active' : ''}`}
                    onMouseDown={(event) => event.preventDefault()}
                    onMouseEnter={() => setActiveIndex(index)}
                    onClick={() => elegir(option)}
                  >
                    <span className="combo__name">{option.nombre_completo}</span>
                    {option.sub ? <span className="combo__sub">Cédula: {option.sub}</span> : null}
                  </li>
                ))
              )}
            </ul>
          </div>
        ) : null}
      </div>
      <span className="field-hint" id={hintId} hidden={!hint}>
        {hint}
      </span>
      <span className="field-error" id={errorId} role="alert">
        {error}
      </span>
    </div>
  );
}
