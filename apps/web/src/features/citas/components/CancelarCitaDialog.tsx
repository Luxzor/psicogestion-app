import { useEffect, useId, useRef, useState } from 'react';
import {
  CircleAlert,
  CircleX,
  Clock,
  LoaderCircle,
  RotateCw,
} from 'lucide-react';
import type { ApiError } from '../../../auth/api';
import { fLarga } from '../../salas/validation';
import { citasApi } from '../api';
import { enHoraClinica, rangoLegible } from '../horario';
import type { Cita } from '../types';
import { mensajeDeError } from '../validation';
import '../../pacientes/styles/pacientes.css';

export type CancelarCitaDialogProps = {
  isOpen: boolean;
  cita: Cita | null;
  onClose: () => void;
  onCanceled?: (cita: Cita) => void;
  accessToken?: string;
};

const isApiError = (error: unknown): error is ApiError =>
  typeof error === 'object' && error !== null && 'codigo' in error && 'mensaje' in error;

function CancelarCitaModal({
  cita,
  onClose,
  onCanceled,
  accessToken,
}: {
  cita: Cita;
  onClose: () => void;
  onCanceled?: (cita: Cita) => void;
  accessToken?: string;
}) {
  const dialogRef = useRef<HTMLElement>(null);
  const titleId = useId();
  const descId = useId();

  const [saving, setSaving] = useState(false);
  const [errorNotice, setErrorNotice] = useState<string | null>(null);
  const [isNetError, setIsNetError] = useState(false);

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
  }, [onClose, saving]);

  const handleCancelar = async () => {
    if (!accessToken || saving) return;
    setSaving(true);
    setErrorNotice(null);
    setIsNetError(false);

    try {
      const cancelada = await citasApi.cancel(cita.id, cita.version, accessToken);
      onCanceled?.(cancelada);
      onClose();
    } catch (err: unknown) {
      if (isApiError(err) && err.codigo !== 'SIN_CONEXION') {
        const msg = mensajeDeError(err.codigo) || err.mensaje;
        setErrorNotice(msg);
      } else {
        setIsNetError(true);
        setErrorNotice(
          'No pudimos cancelar la cita por un error de conexión. La cita no cambió; intenta de nuevo.',
        );
      }
    } finally {
      setSaving(false);
    }
  };

  const fechaIso = enHoraClinica(cita.inicio).fecha;

  return (
    <div
      className="dialog-backdrop"
      onClick={(e) => e.target === e.currentTarget && !saving && onClose()}
      role="presentation"
    >
      <section
        ref={dialogRef}
        className="dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descId}
      >
        <h2 id={titleId}>¿Cancelar la cita {cita.folio}?</h2>

        <div id={descId}>
          <dl className="cita-det">
            <div>
              <dt>Estatus</dt>
              <dd>
                <span className="badge badge--pend">
                  <Clock size={12} aria-hidden="true" />
                  Pendiente
                </span>
              </dd>
            </div>
            <div>
              <dt>Paciente</dt>
              <dd>{cita.paciente.nombre_completo}</dd>
            </div>
            <div>
              <dt>Terapeuta</dt>
              <dd>{cita.terapeuta.nombre_completo}</dd>
            </div>
            <div>
              <dt>Sala</dt>
              <dd>{cita.sala.nombre}</dd>
            </div>
            <div>
              <dt>Fecha</dt>
              <dd>{fLarga(fechaIso)}</dd>
            </div>
            <div>
              <dt>Horario</dt>
              <dd>{rangoLegible(cita.inicio, cita.fin)}</dd>
            </div>
          </dl>

          <p style={{ margin: '1rem 0 0' }}>
            El horario quedará libre para nuevas citas. La cita se conserva en el histórico con
            estatus Cancelada.
          </p>
        </div>

        {errorNotice ? (
          <div className="dialog-notice" style={{ marginTop: '0.8rem' }}>
            <div className="notice error" role="alert">
              <CircleAlert size={17} aria-hidden="true" />
              <div className="notice__body">{errorNotice}</div>
            </div>
          </div>
        ) : null}

        <div className="dialog-actions">
          <button
            type="button"
            className="button button--secondary"
            onClick={onClose}
            disabled={saving}
            autoFocus
          >
            Volver
          </button>
          <button
            type="button"
            className="button button--danger"
            id="can-ok"
            onClick={handleCancelar}
            disabled={saving}
          >
            {saving ? (
              <>
                <LoaderCircle size={16} className="spin" aria-hidden="true" />
                Cancelando...
              </>
            ) : isNetError ? (
              <>
                <RotateCw size={15} aria-hidden="true" />
                Reintentar
              </>
            ) : (
              <>
                <CircleX size={16} aria-hidden="true" />
                Cancelar cita
              </>
            )}
          </button>
        </div>
      </section>
    </div>
  );
}

/**
 * RF 5.4.1–5.4.4, RNF 5.1.3, RNF 5.1.5 (EDT 5.3.5). Diálogo de confirmación para cancelar una cita.
 * Muestra los detalles de la cita a cancelar con estatus Pendiente, advierte que el horario se
 * liberará y que la cita se conservará en el histórico como Cancelada (ADR-20).
 */
export function CancelarCitaDialog({
  isOpen,
  cita,
  ...rest
}: CancelarCitaDialogProps) {
  if (!isOpen || !cita) return null;
  return <CancelarCitaModal key={cita.id} cita={cita} {...rest} />;
}

