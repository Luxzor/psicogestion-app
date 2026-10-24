import {
  CalendarX,
  ChevronLeft,
  CircleX,
  Clock,
  LoaderCircle,
  RotateCw,
  WifiOff,
} from 'lucide-react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import type { ApiError } from '../../../auth/api';
import type { Session } from '../../auth/types';
import { fLarga } from '../../salas/validation';
import { useCita } from '../hooks/useCitas';
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
 * RF 5.2 (EDT 5.3.3). Detalle de solo lectura de una cita (PG-DSN-003 5.5; patrón visual de
 * features/salas/components/DetalleCitaDialog, sin modificarlo). Ruta /inicio/citas/:id. Sin
 * acciones de modificar ni cancelar: eso es de las tareas 5.3.4 y 5.3.5.
 */
export function DetalleCitaPage({ session }: { session: Session }) {
  const { id = '' } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const detalle = useCita(id, session.token);

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
                <p>Detalle de solo lectura.</p>
              </div>
            </div>
          </div>

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
        </>
      )}
    </div>
  );
}
