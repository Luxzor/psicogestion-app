import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  CalendarX,
  ChevronLeft,
  CircleCheck,
  CircleX,
  Clock,
  LoaderCircle,
  RotateCw,
  WifiOff,
  X,
} from 'lucide-react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import type { ApiError } from '../../../auth/api';
import type { Session } from '../../auth/types';
import { fLarga } from '../../salas/validation';
import { CancelarCitaDialog } from '../components/CancelarCitaDialog';
import { citaKeys, useCita } from '../hooks/useCitas';
import { enHoraClinica, rangoLegible } from '../horario';
import type { CitaEstado } from '../types';
import { mensajeDeError } from '../validation';
import '../../pacientes/styles/pacientes.css';

const isApiError = (error: unknown): error is ApiError =>
  typeof error === 'object' && error !== null && 'codigo' in error && 'mensaje' in error;

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

const LIST_PATH = '/inicio/citas';

/**
 * RF 5.2, RF 5.4 (EDT 5.3.3 y EDT 5.3.5). Detalle de una cita con opción a cancelarla
 * si su estatus es Pendiente (PG-DSN-003 5.5; maqueta PG-DSN-003-INT). Ruta /inicio/citas/:id.
 */
export function DetalleCitaPage({ session }: { session: Session }) {
  const { id = '' } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const detalle = useCita(id, session.token);

  const [cancelarDialogOpen, setCancelarDialogOpen] = useState(false);
  const [flashMessage, setFlashMessage] = useState<string | null>(null);

  const volver = () => navigate(LIST_PATH);

  return (
    <div className="page page--narrow">
      <button type="button" className="back-link" onClick={volver}>
        <ChevronLeft size={16} aria-hidden="true" />
        Citas
      </button>

      {detalle.isPending ? (
        <div style={{ textAlign: 'center', padding: '3rem 0', color: 'var(--color-muted)' }}>
          <LoaderCircle size={24} className="spin" aria-hidden="true" />
          <p>Cargando la cita...</p>
        </div>
      ) : detalle.isError ? (
        isApiError(detalle.error) && detalle.error.codigo === 'CITA_NO_ENCONTRADA' ? (
          <div className="empty">
            <span className="empty__icon">
              <CalendarX size={44} aria-hidden="true" />
            </span>
            <h2>No encontramos esa cita</h2>
            <p>
              {mensajeDeError('CITA_NO_ENCONTRADA') ?? 'Revisa el enlace e inténtalo de nuevo.'}
            </p>
            <Link to={LIST_PATH} className="button button--primary">
              Volver a citas
            </Link>
          </div>
        ) : (
          <div className="empty" role="alert">
            <span className="empty__icon">
              <WifiOff size={44} aria-hidden="true" />
            </span>
            <h2>No pudimos cargar la cita</h2>
            <p>Revisa tu conexión e inténtalo de nuevo.</p>
            <button
              type="button"
              className="button button--primary"
              onClick={() => void detalle.refetch()}
            >
              <RotateCw size={15} aria-hidden="true" />
              Reintentar
            </button>
          </div>
        )
      ) : (
        <>
          <div className="page-head">
            <div className="page-title">
              <div>
                <h1>
                  Cita <span className="mono">{detalle.data.folio}</span>
                </h1>
                <p>Detalle de la cita.</p>
              </div>
            </div>
            {detalle.data.estado === 'Pendiente' ? (
              <div className="page-tools">
                <button
                  type="button"
                  className="button button--danger-soft"
                  onClick={() => setCancelarDialogOpen(true)}
                >
                  <CircleX size={16} aria-hidden="true" />
                  Cancelar cita
                </button>
              </div>
            ) : null}
          </div>

          {flashMessage ? (
            <div className="notice success" role="status">
              <CircleCheck size={18} aria-hidden="true" />
              <div className="notice__body">{flashMessage}</div>
              <button
                type="button"
                className="notice__close"
                aria-label="Cerrar aviso"
                onClick={() => setFlashMessage(null)}
              >
                <X size={14} aria-hidden="true" />
              </button>
            </div>
          ) : null}

          <section className="panel">
            <dl className="cita-det">
              <div>
                <dt>Estatus</dt>
                <dd>
                  <EstadoBadge estado={detalle.data.estado} />
                </dd>
              </div>
              <div>
                <dt>Paciente</dt>
                <dd>{detalle.data.paciente.nombre_completo}</dd>
              </div>
              <div>
                <dt>Terapeuta</dt>
                <dd>{detalle.data.terapeuta.nombre_completo}</dd>
              </div>
              <div>
                <dt>Sala</dt>
                <dd>{detalle.data.sala.nombre}</dd>
              </div>
              <div>
                <dt>Fecha</dt>
                <dd>{fLarga(enHoraClinica(detalle.data.inicio).fecha)}</dd>
              </div>
              <div>
                <dt>Horario</dt>
                <dd>{rangoLegible(detalle.data.inicio, detalle.data.fin)}</dd>
              </div>
              {detalle.data.estado === 'Cancelada' && detalle.data.cancelada_en ? (
                <div>
                  <dt>Cancelada el</dt>
                  <dd>{fLarga(enHoraClinica(detalle.data.cancelada_en).fecha)}</dd>
                </div>
              ) : null}
            </dl>
          </section>

          <CancelarCitaDialog
            isOpen={cancelarDialogOpen}
            cita={detalle.data}
            onClose={() => setCancelarDialogOpen(false)}
            onCanceled={(c) => {
              const fechaIso = enHoraClinica(c.inicio).fecha;
              const horario = rangoLegible(c.inicio, c.fin);
              setFlashMessage(
                `Cita ${c.folio} cancelada. El horario de ${c.sala.nombre} del ${fLarga(fechaIso).toLowerCase()}, ${horario}, quedó libre para nuevas citas.`,
              );
              void queryClient.invalidateQueries({ queryKey: citaKeys.todo });
              void detalle.refetch();
            }}
            accessToken={session.token}
          />
        </>
      )}
    </div>
  );
}
