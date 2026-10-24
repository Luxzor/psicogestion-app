import { useEffect, useId, useRef, useState } from 'react';
import { CircleAlert, LoaderCircle, RotateCw } from 'lucide-react';
import { newIdempotencyKey } from '../idempotency';
import { salasApi } from '../api';
import type { Sala } from '../types';
import {
  normalizeSalaNombre,
  SALA_MENSAJES,
  SALA_NOMBRE_MAX,
  validateSalaNombre,
} from '../validation';
import '../../pacientes/styles/pacientes.css';

export type AgregarSalaDialogProps = {
  isOpen: boolean;
  onClose: () => void;
  onCreated?: (sala: Sala) => void;
  accessToken?: string;
};

function AgregarSalaDialogModal({
  onClose,
  onCreated,
  accessToken = '',
}: Omit<AgregarSalaDialogProps, 'isOpen'>) {
  const [nombre, setNombre] = useState('');
  const [error, setError] = useState('');
  const [checking, setChecking] = useState(false);
  const [available, setAvailable] = useState(false);
  const [saving, setSaving] = useState(false);
  const [netError, setNetError] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const idempotencyKeyRef = useRef(newIdempotencyKey());
  const inputRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  const titleId = useId();
  const descId = useId();

  useEffect(() => {
    inputRef.current?.focus();
    return () => {
      abortControllerRef.current?.abort();
    };
  }, []);

  // Manejo de foco y tecla Escape
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !saving) {
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
  }, [saving, onClose]);

  const count = normalizeSalaNombre(nombre).length;
  const isOverLimit = count > SALA_NOMBRE_MAX;

  const handleInputChange = (value: string) => {
    setNombre(value);
    setAvailable(false);
    setNetError(false);
    setNotice(null);

    abortControllerRef.current?.abort();

    const normalized = normalizeSalaNombre(value);
    if (!normalized) {
      setError('');
      setChecking(false);
      return;
    }

    if (normalized.length > SALA_NOMBRE_MAX) {
      setError(SALA_MENSAJES.largo(normalized.length));
      setChecking(false);
      return;
    }

    setError('');
    setChecking(true);

    const controller = new AbortController();
    abortControllerRef.current = controller;

    const timer = setTimeout(async () => {
      try {
        const result = await salasApi.checkAvailability(
          { campo: 'nombre', valor: normalized },
          accessToken,
          controller.signal,
        );
        setChecking(false);
        if (!result.disponible) {
          setError(result.mensaje || SALA_MENSAJES.enUso);
          setAvailable(false);
        } else {
          setError('');
          setAvailable(true);
        }
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') return;
        setChecking(false);
      }
    }, 350);

    return () => clearTimeout(timer);
  };

  const handleSubmit = async () => {
    const err = validateSalaNombre(nombre);
    if (err) {
      setError(err);
      inputRef.current?.focus();
      return;
    }

    if (checking || error) return;

    setSaving(true);
    setNotice(null);

    try {
      const res = await salasApi.register(
        { nombre: normalizeSalaNombre(nombre) },
        accessToken,
        idempotencyKeyRef.current,
      );
      setSaving(false);
      onCreated?.(res.sala);
      onClose();
    } catch (err: unknown) {
      setSaving(false);
      const apiErr = err as { codigo?: string; mensaje?: string; status?: number };
      if (apiErr?.codigo === 'NOMBRE_SALA_EN_USO' || apiErr?.status === 409) {
        setError(apiErr.mensaje || SALA_MENSAJES.enUso);
        setAvailable(false);
        inputRef.current?.focus();
      } else {
        setNetError(true);
        setNotice(
          'No pudimos conectar con el servidor. El nombre que escribiste se conserva; intenta guardar de nuevo.',
        );
      }
    }
  };

  const handleInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (!isSubmitDisabled) {
        void handleSubmit();
      }
    }
  };

  const isSubmitDisabled =
    saving || checking || !!error || !nombre.trim() || isOverLimit;

  return (
    <div className="dialog-backdrop" role="presentation">
      <section
        ref={dialogRef}
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descId}
      >
        <h2 id={titleId}>Agregar sala</h2>
        <div id={descId}>
          <p style={{ marginBottom: '1rem' }}>
            El nombre identifica a la sala en las citas. Debe ser único.
          </p>

          <div className="field">
            <span className="field__label">
              <label htmlFor="sala-nombre">Nombre de la sala</label>
              <small
                id="sala-count"
                style={{ color: isOverLimit ? 'var(--color-error)' : undefined }}
              >
                {count}/10
              </small>
            </span>
            <input
              ref={inputRef}
              id="sala-nombre"
              type="text"
              autoComplete="off"
              placeholder="Por ejemplo, Sala 4"
              aria-describedby="sala-hint sala-error"
              aria-invalid={!!error}
              value={nombre}
              onChange={(e) => handleInputChange(e.target.value)}
              onKeyDown={handleInputKeyDown}
              disabled={saving}
            />
            <span
              className="field-hint"
              id="sala-hint"
              hidden={!!error && !checking}
            >
              {checking ? (
                <span className="field-checking">
                  <LoaderCircle size={13} className="spin" aria-hidden="true" />
                  Verificando que el nombre no exista...
                </span>
              ) : available ? (
                <span style={{ color: 'var(--color-success)' }}>
                  Nombre disponible.
                </span>
              ) : (
                'De 1 a 10 caracteres.'
              )}
            </span>
            <span className="field-error" id="sala-error" role="alert">
              {error}
            </span>
          </div>

          <div id="sala-notice" style={{ marginTop: '0.9rem' }}>
            {notice && (
              <div className="notice error notice--block" role="alert">
                <CircleAlert size={17} aria-hidden="true" />
                <div className="notice__body">{notice}</div>
              </div>
            )}
          </div>
        </div>

        <div className="dialog-actions">
          <button
            type="button"
            className="button button--secondary"
            id="sala-cancel"
            onClick={onClose}
            disabled={saving}
          >
            Cancelar
          </button>
          <button
            type="button"
            className="button button--primary"
            id="sala-ok"
            onClick={handleSubmit}
            disabled={isSubmitDisabled}
          >
            {saving ? (
              <>
                <LoaderCircle size={16} className="spin" aria-hidden="true" />
                Guardando...
              </>
            ) : netError ? (
              <>
                <RotateCw size={15} aria-hidden="true" />
                Reintentar
              </>
            ) : (
              'Guardar sala'
            )}
          </button>
        </div>
      </section>
    </div>
  );
}

/**
 * EDT 5.3.1. Diálogo interactivo para el registro de salas (RF 4.1.1 a RF 4.1.4; RNF 4.1.1 a RNF 4.1.4).
 * Sigue fielmente la maqueta y especificación de PG-DSN-003-INT v0.1.0 (sec. 4.1, CA-4.1-01 a CA-4.1-03).
 */
export function AgregarSalaDialog(props: AgregarSalaDialogProps) {
  if (!props.isOpen) return null;
  return <AgregarSalaDialogModal {...props} />;
}
