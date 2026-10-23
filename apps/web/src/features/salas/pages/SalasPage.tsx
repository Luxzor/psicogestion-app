import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  CalendarCheck,
  ChevronLeft,
  ChevronRight,
  CircleCheck,
  DoorOpen,
  Plus,
  RotateCw,
  Trash2,
  WifiOff,
  X,
} from 'lucide-react';
import type { Session } from '../../auth/types';
import { AgregarSalaDialog } from '../components/AgregarSalaDialog';
import { EliminarSalaDialog } from '../components/EliminarSalaDialog';
import { salasApi } from '../api';
import type { DisponibilidadSala, Sala } from '../types';
import {
  addDias,
  fechaDeIso,
  fMedia,
  getSalaColor,
  isoDe,
} from '../validation';
import '../../pacientes/styles/pacientes.css';

export function SalasPage({ session }: { session?: Session }) {
  const navigate = useNavigate();
  const hoyIso = isoDe(new Date());
  const token = session?.token;

  const [fecha, setFecha] = useState(hoyIso);
  const [salas, setSalas] = useState<DisponibilidadSala[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [reloadTrigger, setReloadTrigger] = useState(0);
  const [nuevaSalaId, setNuevaSalaId] = useState<string | null>(null);

  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [isEliminarOpen, setIsEliminarOpen] = useState(false);
  const [salaParaEliminar, setSalaParaEliminar] = useState<Sala | null>(null);
  const [flashMessage, setFlashMessage] = useState<string | null>(null);

  const refetch = () => {
    setLoading(true);
    setError(false);
    setReloadTrigger((c) => c + 1);
  };

  useEffect(() => {
    let ignore = false;
    const fetchData = async () => {
      try {
        const resp = await salasApi.getDisponibilidad({ fecha }, token);
        if (!ignore) {
          setSalas(resp.salas);
          setLoading(false);
        }
      } catch {
        if (!ignore) {
          setError(true);
          setLoading(false);
        }
      }
    };

    void fetchData();
    return () => {
      ignore = true;
    };
  }, [fecha, token, reloadTrigger]);

  const handleCreated = (sala: Sala) => {
    setNuevaSalaId(sala.id);
    setFlashMessage(`Sala “${sala.nombre}” agregada. Ya está disponible para agendar citas.`);
    refetch();
  };

  const handleDischarged = (sala: Sala) => {
    setFlashMessage(`Sala “${sala.nombre}” eliminada.`);
    refetch();
  };

  const handleDateMove = (d: number) => {
    if (d === 0) {
      setFecha(hoyIso);
    } else {
      let nextF = addDias(fecha, d);
      if (fechaDeIso(nextF).getDay() === 0) {
        nextF = addDias(nextF, d);
      }
      setFecha(nextF);
    }
  };

  const handleRowClick = (salaId: string) => {
    navigate(`/inicio/salas/${salaId}?fecha=${fecha}`);
  };

  const handleOpenEliminar = (sala?: Sala) => {
    setSalaParaEliminar(sala ?? null);
    setIsEliminarOpen(true);
  };

  const thead = (
    <thead>
      <tr>
        <th scope="col">Sala</th>
        <th scope="col">Estado el {fMedia(fecha).toLowerCase()}</th>
        <th scope="col" className="col-secondary">
          Ocupación de 7:00 a 17:00
        </th>
        <th scope="col">Citas del día</th>
        <th scope="col">
          <span className="sr-only">Acciones</span>
        </th>
      </tr>
    </thead>
  );

  return (
    <div className="page">
      <div className="page-head">
        <div className="page-title">
          <span className="page-title__icon">
            <DoorOpen size={22} aria-hidden="true" />
          </span>
          <div>
            <h1>Salas</h1>
            <p id="list-count">
              {loading
                ? 'Cargando...'
                : error
                  ? '\u00A0'
                  : `${salas.length} ${salas.length === 1 ? 'sala registrada' : 'salas registradas'}`}
            </p>
          </div>
        </div>

        <div className="page-tools">
          <span className="segmented__label" style={{ padding: 0 }}>
            Estado del día:
          </span>
          <div className="datebar">
            <button
              type="button"
              onClick={() => handleDateMove(-1)}
              aria-label="Día anterior"
            >
              <ChevronLeft size={16} aria-hidden="true" />
            </button>
            <button type="button" onClick={() => handleDateMove(0)}>
              Hoy
            </button>
            <button
              type="button"
              onClick={() => handleDateMove(1)}
              aria-label="Día siguiente"
            >
              <ChevronRight size={16} aria-hidden="true" />
            </button>
            <input
              type="date"
              id="sl-fecha"
              value={fecha}
              onChange={(e) => e.target.value && setFecha(e.target.value)}
              aria-label="Elegir día"
            />
          </div>
          <button
            type="button"
            className="button button--danger-soft"
            id="btn-del"
            onClick={() => handleOpenEliminar()}
          >
            <Trash2 size={16} aria-hidden="true" />
            Eliminar sala
          </button>
          <button
            type="button"
            className="button button--primary"
            id="btn-agregar-sala"
            onClick={() => setIsDialogOpen(true)}
          >
            <Plus size={16} aria-hidden="true" />
            Agregar sala
          </button>
        </div>
      </div>

      {flashMessage && (
        <div className="notice success notice--block" role="status" aria-live="polite">
          <CircleCheck size={17} aria-hidden="true" />
          <div className="notice__body">{flashMessage}</div>
          <button
            type="button"
            className="notice__close"
            onClick={() => setFlashMessage(null)}
            aria-label="Cerrar aviso"
          >
            <X size={15} aria-hidden="true" />
          </button>
        </div>
      )}

      <section className="panel" id="list-panel" aria-live="polite">
        {loading ? (
          <table className="data-table">
            {thead}
            <tbody>
              {Array.from({ length: 6 }, (_, i) => (
                <tr key={i} className="is-static">
                  <td>
                    <div className="person">
                      <span
                        className="skeleton skeleton--circle"
                        style={{ borderRadius: '10px' }}
                      />
                      <span className="skeleton" style={{ width: '6rem' }} />
                    </div>
                  </td>
                  <td>
                    <span className="skeleton" style={{ width: '5.5rem' }} />
                  </td>
                  <td className="col-secondary">
                    <span className="skeleton" style={{ width: '12rem' }} />
                  </td>
                  <td>
                    <span className="skeleton" style={{ width: '4rem' }} />
                  </td>
                  <td />
                </tr>
              ))}
            </tbody>
          </table>
        ) : error ? (
          <div className="empty" role="alert">
            <span className="empty__icon">
              <WifiOff size={40} aria-hidden="true" />
            </span>
            <h2>No pudimos cargar las salas</h2>
            <p>Revisa tu conexión e inténtalo de nuevo. El día elegido se conserva.</p>
            <button
              type="button"
              className="button button--primary"
              id="retry"
              onClick={refetch}
            >
              <RotateCw size={16} aria-hidden="true" />
              Reintentar
            </button>
          </div>
        ) : salas.length === 0 ? (
          <div className="empty">
            <span className="empty__icon">
              <DoorOpen size={44} aria-hidden="true" />
            </span>
            <h2>Aún no hay salas</h2>
            <p>
              Usa “Agregar sala” para registrar la primera. Sin salas no es posible agendar citas.
            </p>
          </div>
        ) : (
          <table className="data-table">
            {thead}
            <tbody>
              {salas.map((s, idx) => {
                const color = getSalaColor(idx);
                const isReservada = (s.bloques_ocupados ?? 0) > 0;
                const isNew = nuevaSalaId === s.id;
                const totalCitas = s.total_citas ?? s.citas?.length ?? 0;
                const blq = s.bloques_ocupados ?? 0;

                return (
                  <tr
                    key={s.id}
                    tabIndex={0}
                    data-sala={s.id}
                    className={isNew ? 'is-new' : ''}
                    aria-label={`Ver el día de ${s.nombre}`}
                    onClick={() => handleRowClick(s.id)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handleRowClick(s.id);
                    }}
                  >
                    <td>
                      <div
                        className="room-name"
                        style={{ '--c': color } as React.CSSProperties}
                      >
                        <span className="tile">
                          <DoorOpen size={17} aria-hidden="true" />
                        </span>
                        {s.nombre}
                      </div>
                    </td>
                    <td>
                      {isReservada ? (
                        <span className="badge badge--res">
                          <CalendarCheck size={12} aria-hidden="true" />
                          Reservada
                        </span>
                      ) : (
                        <span className="badge badge--ok">
                          <CircleCheck size={12} aria-hidden="true" />
                          Libre
                        </span>
                      )}
                    </td>
                    <td className="col-secondary">
                      <div
                        className="occ"
                        style={{ '--c': color } as React.CSSProperties}
                        aria-hidden="true"
                      >
                        {s.bloques.map((b, bIdx) => (
                          <i
                            key={bIdx}
                            className={b.estado === 'reservada' ? 'on' : ''}
                          />
                        ))}
                      </div>
                      <div className="occ-scale" aria-hidden="true">
                        <span>7:00</span>
                        <span>12:00</span>
                        <span>17:00</span>
                      </div>
                    </td>
                    <td className="num muted">
                      {isReservada
                        ? `${totalCitas} ${totalCitas === 1 ? 'cita' : 'citas'} · ${blq} de 20 bloques`
                        : 'Sin citas'}
                    </td>
                    <td>
                      <div className="row-actions">
                        <button
                          type="button"
                          className="icon-act is-danger"
                          data-del={s.id}
                          aria-label={`Eliminar ${s.nombre}`}
                          title="Eliminar sala"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleOpenEliminar({
                              id: s.id,
                              nombre: s.nombre,
                              activo: s.activo ?? true,
                              fecha_baja: null,
                              fecha_registro: '',
                              version: 1,
                            });
                          }}
                        >
                          <Trash2 size={16} aria-hidden="true" />
                        </button>
                        <span className="icon-act" aria-hidden="true">
                          <ChevronRight size={16} aria-hidden="true" />
                        </span>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </section>

      <button
        type="button"
        className="button button--primary fab"
        id="fab"
        onClick={() => setIsDialogOpen(true)}
      >
        <Plus size={18} aria-hidden="true" />
        Agregar sala
      </button>

      <AgregarSalaDialog
        isOpen={isDialogOpen}
        onClose={() => setIsDialogOpen(false)}
        onCreated={handleCreated}
        accessToken={session?.token}
      />

      <EliminarSalaDialog
        isOpen={isEliminarOpen}
        onClose={() => {
          setIsEliminarOpen(false);
          setSalaParaEliminar(null);
        }}
        preselectedSala={salaParaEliminar}
        onDischarged={handleDischarged}
        accessToken={session?.token}
      />
    </div>
  );
}
