import { useEffect, useId, useRef } from 'react';
import { CalendarX, CircleCheck, CircleX, Clock, UserX } from 'lucide-react';
import type { CitaSalaDia } from '../types';
import { durTxt, fLarga, getSalaColor, hhmm } from '../validation';
import '../../pacientes/styles/pacientes.css';

export type DetalleCitaDialogProps = {
  isOpen: boolean;
  cita: CitaSalaDia | null;
  onClose: () => void;
  salaIndex?: number;
};

export function DetalleCitaDialog({
  isOpen,
  cita,
  onClose,
  salaIndex = 0,
}: DetalleCitaDialogProps) {
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

    if (isOpen) {
      window.addEventListener('keydown', handleKeyDown);
    }
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen || !cita) return null;

  const salaColor = getSalaColor(salaIndex);
  const duracion = cita.fin_minutos - cita.ini_minutos;

  const renderBadge = (estado: string) => {
    switch (estado) {
      case 'Pendiente':
        return (
          <span className="badge badge--pend">
            <Clock size={12} aria-hidden="true" />
            Pendiente
          </span>
        );
      case 'Cancelada':
        return (
          <span className="badge badge--canc">
            <CircleX size={12} aria-hidden="true" />
            Cancelada
          </span>
        );
      case 'Vencida':
        return (
          <span className="badge badge--venc">
            <CalendarX size={12} aria-hidden="true" />
            Vencida
          </span>
        );
      default:
        return (
          <span className="badge badge--ok">
            <CircleCheck size={12} aria-hidden="true" />
            {estado}
          </span>
        );
    }
  };

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
              <dd>{renderBadge(cita.estado)}</dd>
            </div>
            <div>
              <dt>Paciente</dt>
              <dd>{cita.paciente.nombre_completo}</dd>
            </div>
            <div>
              <dt>Terapeuta</dt>
              <dd>
                {cita.terapeuta.nombre_completo}
                {cita.terapeuta.activo === false && (
                  <span className="badge badge--off">
                    <UserX size={12} aria-hidden="true" />
                    Dado de baja
                  </span>
                )}
              </dd>
            </div>
            <div>
              <dt>Sala</dt>
              <dd>
                <span className="dot" style={{ backgroundColor: salaColor }} aria-hidden="true" />
                {cita.sala.nombre}
              </dd>
            </div>
            <div>
              <dt>Fecha</dt>
              <dd>{fLarga(cita.inicio.slice(0, 10))}</dd>
            </div>
            <div>
              <dt>Horario</dt>
              <dd>
                {hhmm(cita.ini_minutos)} a {hhmm(cita.fin_minutos)}{' '}
                <span className="opt-note">({durTxt(duracion)})</span>
              </dd>
            </div>
          </dl>
        </div>

        <div className="dialog-actions">
          <button type="button" className="button button--secondary" onClick={onClose} autoFocus>
            Cerrar
          </button>
        </div>
      </section>
    </div>
  );
}
