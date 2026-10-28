import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { LoaderCircle, Search } from 'lucide-react';
import { citasApi } from '../api';
import type { Cita } from '../types';
import { FOLIO_PATTERN, normalizeFolio } from '../validation';
import '../../pacientes/styles/pacientes.css';

export type CancelarPorFolioDialogProps = {
  isOpen: boolean;
  onClose: () => void;
  onSelectCita: (cita: Cita) => void;
  accessToken?: string;
};

function CancelarPorFolioModal({
  onClose,
  onSelectCita,
  accessToken,
}: Omit<CancelarPorFolioDialogProps, 'isOpen'>) {
  const dialogRef = useRef<HTMLElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const titleId = useId();
  const descId = useId();

  const [folio, setFolio] = useState('');
  const [error, setError] = useState('');
  const [searching, setSearching] = useState(false);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !searching) {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key === 'Tab') {
        const dialog = dialogRef.current;
        if (!dialog) return;
        const focusables = dialog.querySelectorAll<HTMLElement>(
          'button:not([disabled]), input:not([disabled])',
        );
        if (!focusables.length) return;
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose, searching]);

  const handleSubmit = async (e?: FormEvent) => {
    e?.preventDefault();
    if (!accessToken || searching) return;

    const trimmed = folio.trim();
    if (!trimmed) {
      setError('Escribe el folio de la cita.');
      inputRef.current?.focus();
      return;
    }

    const normalized = normalizeFolio(trimmed);
    if (!FOLIO_PATTERN.test(normalized)) {
      setError('El folio no tiene un formato válido. Ejemplo: C26000001.');
      inputRef.current?.focus();
      return;
    }

    setSearching(true);
    setError('');

    try {
      const resp = await citasApi.list({ folio: normalized, pagina: 1, tamano: 1 }, accessToken);
      const found = resp.datos.find((c) => c.folio.toUpperCase() === normalized) ?? resp.datos[0];

      if (!found || found.folio.toUpperCase() !== normalized) {
        setError('No existe una cita con ese folio. Revísalo e intenta de nuevo.');
        inputRef.current?.focus();
        return;
      }

      if (found.estado === 'Cancelada') {
        setError('Esa cita ya está cancelada.');
        inputRef.current?.focus();
        return;
      }

      if (found.estado === 'Vencida') {
        setError('Esa cita ya venció; no es posible cancelarla.');
        inputRef.current?.focus();
        return;
      }

      onSelectCita(found);
      onClose();
    } catch {
      setError('No pudimos buscar la cita por un error de conexión. Intenta de nuevo.');
      inputRef.current?.focus();
    } finally {
      setSearching(false);
    }
  };

  return (
    <div
      className="dialog-backdrop"
      onClick={(e) => e.target === e.currentTarget && !searching && onClose()}
      role="presentation"
    >
      <section
        ref={dialogRef}
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descId}
      >
        <h2 id={titleId}>Cancelar cita por folio</h2>

        <p id={descId} style={{ marginBottom: '1rem' }}>
          Escribe el folio que recibió el paciente en su confirmación.
        </p>

        <form onSubmit={handleSubmit} noValidate>
          <div className="field">
            <label htmlFor="folio-in">Folio</label>
            <input
              ref={inputRef}
              id="folio-in"
              type="text"
              className="is-mono"
              autoComplete="off"
              spellCheck="false"
              placeholder="C26000001"
              value={folio}
              disabled={searching}
              onChange={(e) => {
                setFolio(e.target.value.toUpperCase());
                setError('');
              }}
              aria-invalid={Boolean(error)}
              aria-describedby="folio-hint folio-err"
              style={{
                fontFamily: 'ui-monospace, monospace',
                letterSpacing: '0.04em',
                fontWeight: 650,
              }}
            />
            <span className="field-hint" id="folio-hint">
              Formato C + 8 dígitos (ej. C26000001). No distingue mayúsculas.
            </span>
            {error ? (
              <span className="field-error" id="folio-err" role="alert">
                {error}
              </span>
            ) : null}
          </div>

          <div className="dialog-actions" style={{ marginTop: '1.2rem' }}>
            <button
              type="button"
              className="button button--secondary"
              onClick={onClose}
              disabled={searching}
            >
              Cerrar
            </button>
            <button
              type="submit"
              className="button button--primary"
              id="folio-ok"
              disabled={searching}
            >
              {searching ? (
                <>
                  <LoaderCircle size={15} className="spin" aria-hidden="true" />
                  Buscando...
                </>
              ) : (
                <>
                  <Search size={15} aria-hidden="true" />
                  Buscar cita
                </>
              )}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}

/**
 * RF 5.4.1–5.4.2 (EDT 5.3.5). Diálogo interactivo para buscar una cita por su folio y proceder
 * con la cancelación (PG-DSN-003 5.5; maqueta dialogCancelarFolio de PG-DSN-003-INT).
 */
export function CancelarPorFolioDialog({
  isOpen,
  ...rest
}: CancelarPorFolioDialogProps) {
  if (!isOpen) return null;
  return <CancelarPorFolioModal {...rest} />;
}

