import { useEffect, useId, useRef } from 'react';
import { CircleX, UserX } from 'lucide-react';
import { fLarga } from '../../salas/validation';
import { enHoraClinica, etiquetaDuracion, rangoLegible } from '../horario';
import type { Cita, CitaEstado } from '../types';
import { Clock, CalendarX } from 'lucide-react';
import '../../pacientes/styles/pacientes.css';

export type DetalleCitaDialogProps = {
  isOpen: boolean;
  cita: Cita | null;
  onClose: () => void;
  onCancelar?: (cita: Cita) => void;
  salaColor?: string;
};

function EstadoBadge({ estado }: { estado: CitaEstado }) {
  if (estado === 'Pendiente') {
    return (
      <span className="badge badge--pend">
        <Clock size={12} aria-hidden="true" />
        Pendiente
      </span>
    );
  }
  if (estado === 'Cancelada') {
    return (
      <span className="badge badge--canc">
        <CircleX size={12} aria-hidden="true" />
        Cancelada
      </span>
    );
  }
  return (
    <span className="badge badge--venc">
      <CalendarX size={12} aria-hidden="true" />
      Vencida
    </span>
  );
}

function DetalleCitaModal({
  cita,
  onClose,
  onCancelar,
  salaColor = '#002e5f',
}: {
  cita: Cita;
  onClose: () => void;
  onCancelar?: (cita: Cita) => void;
  salaColor?: string;
}) {
  const dialogRef = useRef<HTMLElement>(null);
  const titleId = useId();

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
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
  }, [onClose]);

  const fechaIso = enHoraClinica(cita.inicio).fecha;
  const duracionMinutos = (cita.duracion_bloques || 1) * 30;

  return (
    <div
      className="dialog-backdrop"
      onClick={(e) => e.target === e.currentTarget && onClose()}
      role="presentation"
    >
      <section
        ref={dialogRef}
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <div className="dialog-head">
          <h2 id={titleId}>Cita {cita.folio}</h2>
        </div>

        <div className="dialog-body">
          <dl className="cita-det">
            <div>
              <dt>Estatus</dt>
              <dd>
                <EstadoBadge estado={cita.estado} />
              </dd>
            </div>
            <div>
              <dt>Paciente</dt>
              <dd>{cita.paciente.nombre_completo}</dd>
            </div>
            <div>
              <dt>Terapeuta</dt>
              <dd>
                {cita.terapeuta.nombre_completo}
                {cita.terapeuta.activo === false ? (
                  <span className="badge badge--off" style={{ marginLeft: '0.4rem' }}>
                    <UserX size={12} aria-hidden="true" />
                    Dado de baja
                  </span>
                ) : null}
              </dd>
            </div>
            <div>
              <dt>Sala</dt>
              <dd>
                <span className="dot" style={{ backgroundColor: salaColor }} aria-hidden="true" />{' '}
                {cita.sala.nombre}
                {cita.sala.activo === false ? (
                  <span className="badge badge--off" style={{ marginLeft: '0.4rem' }}>
                    Eliminada
                  </span>
                ) : null}
              </dd>
            </div>
            <div>
              <dt>Fecha</dt>
              <dd>{fLarga(fechaIso)}</dd>
            </div>
            <div>
              <dt>Horario</dt>
              <dd>
                {rangoLegible(cita.inicio, cita.fin)}{' '}
                <span className="opt-note">({etiquetaDuracion(duracionMinutos)})</span>
              </dd>
            </div>
            {cita.estado === 'Cancelada' && cita.cancelada_en ? (
              <div>
                <dt>Cancelada el</dt>
                <dd>{fLarga(enHoraClinica(cita.cancelada_en).fecha)}</dd>
              </div>
            ) : null}
          </dl>
        </div>

        <div className="dialog-actions">
          {cita.estado === 'Pendiente' ? (
            <button
              type="button"
              className="button button--danger-soft"
              onClick={() => {
                onClose();
                onCancelar?.(cita);
              }}
            >
              <CircleX size={16} aria-hidden="true" />
              Cancelar cita
            </button>
          ) : null}
          <button type="button" className="button button--secondary" onClick={onClose} autoFocus>
            Cerrar
          </button>
        </div>
      </section>
    </div>
  );
}

/**
 * RF 5.2, RF 5.4. Diálogo de detalle de cita (PG-DSN-003-INT dialogCita).
 * Muestra toda la información de la cita y permite cancelar si está Pendiente.
 */
export function DetalleCitaDialog({
  isOpen,
  cita,
  ...rest
}: DetalleCitaDialogProps) {
  if (!isOpen || !cita) return null;
  return <DetalleCitaModal key={cita.id} cita={cita} {...rest} />;
}
