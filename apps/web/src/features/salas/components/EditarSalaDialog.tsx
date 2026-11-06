import { useEffect, useId, useRef, useState } from 'react';
import { CircleAlert, LoaderCircle, RotateCw } from 'lucide-react';
import { salasApi } from '../api';
import type { Sala } from '../types';
import {
  normalizeSalaNombre,
  SALA_MENSAJES,
  SALA_NOMBRE_MAX,
  validateSalaNombre,
} from '../validation';
import '../../pacientes/styles/pacientes.css';

export type EditarSalaDialogProps = {
  isOpen: boolean;
  sala: Sala | null;
  onClose: () => void;
  onUpdated?: (sala: Sala) => void;
  accessToken?: string;
};

type ModalProps = {
  sala: Sala;
  onClose: () => void;
  onUpdated?: (sala: Sala) => void;
  accessToken?: string;
};

function EditarSalaDialogModal({
  sala,
  onClose,
  onUpdated,
  accessToken = '',
}: ModalProps) {
  const [nombre, setNombre] = useState(sala.nombre);
  const [currentVersion, setCurrentVersion] = useState(sala.version);
  const [error, setError] = useState('');
  const [checking, setChecking] = useState(false);
  const [saving, setSaving] = useState(false);
  const [netError, setNetError] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const inputRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const titleId = useId();
  const descId = useId();

  // Obtener la versión más reciente de la sala y enfocar el input
  useEffect(() => {
    let ignore = false;
    salasApi
      .getById(sala.id, accessToken)
      .then((res) => {
        if (!ignore) {
          setCurrentVersion(res.sala.version);
        }
      })
      .catch(() => {
        // En caso de fallo de red al leer la versión, conservar la pasada por props
      });

    inputRef.current?.focus();
    inputRef.current?.select();

    return () => {
      ignore = true;
      if (timerRef.current) clearTimeout(timerRef.current);
      abortControllerRef.current?.abort();
    };
  }, [sala.id, accessToken]);

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
  const hasChanged = normalizeSalaNombre(nombre) !== sala.nombre;

  const handleInputChange = (value: string) => {
    setNombre(value);
    setNetError(false);
    setNotice(null);

    if (timerRef.current) clearTimeout(timerRef.current);
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

    if (normalized.toLowerCase() === sala.nombre.toLowerCase()) {
      setError('');
      setChecking(false);
      return;
    }

    setError('');
    setChecking(true);

    const controller = new AbortController();
    abortControllerRef.current = controller;

    timerRef.current = setTimeout(async () => {
      try {
        const result = await salasApi.checkAvailability(
          { campo: 'nombre', valor: normalized, excluir_id: sala.id },
          accessToken,
          controller.signal,
        );
        setChecking(false);
        if (!result.disponible) {
          setError(result.mensaje || SALA_MENSAJES.enUso);
        } else {
          setError('');
        }
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') return;
        setChecking(false);
      }
    }, 350);
  };

  const handleSubmit = async () => {
    const err = validateSalaNombre(nombre);
    if (err) {
      setError(err);
      inputRef.current?.focus();
      return;
    }

    if (!hasChanged) {
      onClose();
      return;
    }

    if (checking || error) return;

    if (timerRef.current) clearTimeout(timerRef.current);
    abortControllerRef.current?.abort();

    setSaving(true);
    setNotice(null);

    try {
      const res = await salasApi.rename(
        sala.id,
        { nombre: normalizeSalaNombre(nombre), version: currentVersion },
        accessToken,
      );
      setSaving(false);
      onUpdated?.(res.sala);
      onClose();
    } catch (err: unknown) {
      setSaving(false);
      const apiErr = err as { codigo?: string; mensaje?: string; status?: number };
      if (apiErr?.codigo === 'NOMBRE_SALA_EN_USO' || apiErr?.status === 409) {
        setError(apiErr.mensaje || SALA_MENSAJES.enUso);
      } else if (apiErr?.codigo === 'CONFLICTO_VERSION') {
        setNotice(
          apiErr.mensaje ||
            'La sala fue modificada por otro usuario. Recarga la página para continuar.',
        );
      } else {
        setNetError(true);
      }
    }
  };

  const isButtonDisabled =
    saving ||
    checking ||
    Boolean(error) ||
    !normalizeSalaNombre(nombre) ||
    isOverLimit ||
    !hasChanged;

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
        <h2 id={titleId}>Editar sala</h2>
        <p id={descId} className="dialog-description">
          Modifica el nombre de la sala. Debe ser único y tener hasta 10 caracteres.
        </p>

        {notice && (
          <div className="notice warning" role="alert">
            <CircleAlert size={16} aria-hidden="true" />
            <div className="notice__body">{notice}</div>
          </div>
        )}

        {netError && (
          <div className="notice warning" role="alert">
            <CircleAlert size={16} aria-hidden="true" />
            <div className="notice__body">
              No se pudo guardar la modificación. Revisa tu conexión e inténtalo de nuevo.
            </div>
            <div className="notice__actions">
              <button type="button" className="button button--secondary" onClick={handleSubmit}>
                <RotateCw size={14} aria-hidden="true" />
                Reintentar
              </button>
            </div>
          </div>
        )}

        <div className="dialog-body">
          <label className={`field ${error ? 'has-error' : ''}`}>
            <span className="field__label">Nombre de la sala *</span>
            <input
              ref={inputRef}
              type="text"
              id="editar-nombre-sala"
              name="nombre"
              value={nombre}
              maxLength={15}
              disabled={saving}
              aria-invalid={Boolean(error)}
              aria-describedby={`${descId} editar-char-count ${error ? 'editar-nombre-error' : ''}`}
              onChange={(e) => handleInputChange(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  if (!isButtonDisabled) void handleSubmit();
                }
              }}
            />
            <span
              id="editar-char-count"
              className={`field__count ${isOverLimit ? 'is-over' : ''}`}
              aria-live="polite"
            >
              {count}/{SALA_NOMBRE_MAX}
            </span>
          </label>

          {error && (
            <p id="editar-nombre-error" className="field-error" role="alert">
              {error}
            </p>
          )}

          {checking && (
            <p className="field-hint" aria-live="polite">
              <LoaderCircle size={14} className="spin" aria-hidden="true" />
              Comprobando disponibilidad del nombre...
            </p>
          )}
        </div>

        <div className="dialog-actions">
          <button
            type="button"
            className="button button--secondary"
            onClick={onClose}
            disabled={saving}
          >
            Cancelar
          </button>
          <button
            type="button"
            className="button button--primary"
            onClick={handleSubmit}
            disabled={isButtonDisabled}
          >
            {saving ? (
              <>
                <LoaderCircle size={16} className="spin" aria-hidden="true" />
                Guardando...
              </>
            ) : (
              'Guardar cambios'
            )}
          </button>
        </div>
      </section>
    </div>
  );
}

export function EditarSalaDialog({ isOpen, sala, ...props }: EditarSalaDialogProps) {
  if (!isOpen || !sala) return null;
  return <EditarSalaDialogModal key={sala.id} sala={sala} {...props} />;
}
