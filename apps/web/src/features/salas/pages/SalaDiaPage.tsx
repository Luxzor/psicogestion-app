import { useEffect, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  ChevronLeft,
  ChevronRight,
  DoorOpen,
  RotateCw,
  WifiOff,
} from 'lucide-react';
import type { Session } from '../../auth/types';
import { DetalleCitaDialog } from '../components/DetalleCitaDialog';
import { salasApi } from '../api';
import type { CitaSalaDia, DisponibilidadSala } from '../types';
import {
  addDias,
  BLOQUES,
  esPasado,
  fechaDeIso,
  fLarga,
  getSalaColor,
  hhmm,
  isoDe,
} from '../validation';
import '../../pacientes/styles/pacientes.css';

export function SalaDiaPage({ session }: { session?: Session }) {
  const { id } = useParams<{ id: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();

  const hoyIso = isoDe(new Date());
  const fecha = searchParams.get('fecha') || hoyIso;
  const token = session?.token;

  const [salaDisponibilidad, setSalaDisponibilidad] = useState<DisponibilidadSala | null>(null);
  const [salaIndex, setSalaIndex] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [reloadTrigger, setReloadTrigger] = useState(0);
  const [selectedCita, setSelectedCita] = useState<CitaSalaDia | null>(null);

  const refetch = () => {
    setLoading(true);
    setError(false);
    setReloadTrigger((c) => c + 1);
  };

  useEffect(() => {
    let ignore = false;
    if (!id) return;

    const fetchData = async () => {
      try {
        const resp = await salasApi.getDisponibilidad({ fecha }, token);
        const index = resp.salas.findIndex((s) => s.id === id);
        if (!ignore) {
          if (index >= 0) {
            setSalaDisponibilidad(resp.salas[index]);
            setSalaIndex(index);
          } else {
            const salaResp = await salasApi.getById(id, token);
            setSalaDisponibilidad({
              id: salaResp.sala.id,
              nombre: salaResp.sala.nombre,
              activo: salaResp.sala.activo,
              bloques: [],
              citas: [],
              total_citas: 0,
              bloques_ocupados: 0,
            });
          }
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
  }, [id, fecha, token, reloadTrigger]);

  const handleDateMove = (d: number) => {
    if (d === 0) {
      setSearchParams({ fecha: hoyIso });
    } else {
      let nextF = addDias(fecha, d);
      // Si el día es domingo, saltar al siguiente día hábil
      if (fechaDeIso(nextF).getDay() === 0) {
        nextF = addDias(nextF, d);
      }
      setSearchParams({ fecha: nextF });
    }
  };

  const handleDateChange = (newF: string) => {
    if (newF) {
      setSearchParams({ fecha: newF });
    }
  };

  const salaColor = getSalaColor(salaIndex);
  const citas = salaDisponibilidad?.citas ?? [];
  const bloquesOcupados = salaDisponibilidad?.bloques_ocupados ?? 0;
  const isReservada = citas.length > 0 || bloquesOcupados > 0;

  return (
    <div className="page page--narrow">
      <button
        type="button"
        className="back-link"
        onClick={() => navigate('/inicio/salas')}
      >
        <ChevronLeft size={16} aria-hidden="true" />
        Salas
      </button>

      {loading ? (
        <div style={{ textAlign: 'center', padding: '3rem 0', color: 'var(--color-muted)' }}>
          <p>Cargando información de la sala...</p>
        </div>
      ) : error ? (
        <div className="empty" role="alert">
          <span className="empty__icon">
            <WifiOff size={40} aria-hidden="true" />
          </span>
          <h2>No pudimos cargar la sala</h2>
          <p>Revisa tu conexión e inténtalo de nuevo. El día elegido se conserva.</p>
          <button
            type="button"
            className="button button--primary"
            onClick={refetch}
          >
            <RotateCw size={16} aria-hidden="true" />
            Reintentar
          </button>
        </div>
      ) : !salaDisponibilidad ? (
        <div className="empty">
          <span className="empty__icon">
            <DoorOpen size={44} aria-hidden="true" />
          </span>
          <h2>No encontramos la sala indicada</h2>
          <p>La sala que buscas no existe o fue eliminada.</p>
        </div>
      ) : (
        <>
          <div className="page-head">
            <div
              className="page-title room-name"
              style={{ '--c': salaColor } as React.CSSProperties}
            >
              <span
                className="tile"
                style={{ width: '2.6rem', height: '2.6rem', borderRadius: '12px' }}
              >
                <DoorOpen size={22} aria-hidden="true" />
              </span>
              <div>
                <h1>{salaDisponibilidad.nombre}</h1>
                <p>Estado por día · {fLarga(fecha)}</p>
              </div>
            </div>

            <div className="page-tools">
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
                  id="sd-fecha"
                  value={fecha}
                  onChange={(e) => handleDateChange(e.target.value)}
                  aria-label="Elegir día"
                />
              </div>
            </div>
          </div>

          <dl className="kpis">
            <div className="kpi">
              <dt>Estado del día</dt>
              <dd>
                {isReservada ? (
                  <span className="badge badge--res" style={{ fontSize: '0.8rem' }}>
                    Reservada
                  </span>
                ) : (
                  <span className="badge badge--ok" style={{ fontSize: '0.8rem' }}>
                    Libre
                  </span>
                )}
              </dd>
            </div>
            <div className="kpi">
              <dt>Bloques ocupados</dt>
              <dd>
                {bloquesOcupados} <span className="opt-note">de 20</span>
              </dd>
            </div>
            <div className="kpi">
              <dt>Citas</dt>
              <dd>{citas.length}</dd>
            </div>
          </dl>

          <section className="panel">
            <h2 className="panel__title" style={{ paddingBottom: '0.6rem' }}>
              Horarios de 7:00 a 17:00
            </h2>
            <ul className="day-list">
              {BLOQUES.map((b) => {
                // Comprobar si hay una cita que inicia exactamente en este bloque
                const c = citas.find((x) => x.ini_minutos === b);
                if (c) {
                  return (
                    <li
                      key={b}
                      className="day-row is-busy"
                      style={{ '--c': salaColor } as React.CSSProperties}
                    >
                      <span className="day-row__t">
                        {hhmm(c.ini_minutos)} – {hhmm(c.fin_minutos)}
                      </span>
                      <span>
                        <span className="badge badge--res">Reservada</span>
                      </span>
                      <span className="day-row__d">
                        <strong>{c.paciente.nombre_completo}</strong> ·{' '}
                        {c.terapeuta.nombre_completo} ·{' '}
                        <span className="mono">{c.folio}</span>
                        {c.estado === 'Vencida' ? ' · Vencida' : ''}
                      </span>
                      <button
                        type="button"
                        className="text-button"
                        onClick={() => setSelectedCita(c)}
                      >
                        Ver cita
                      </button>
                    </li>
                  );
                }

                // Si este bloque cae dentro del rango de una cita que ya inició antes, no se muestra otra fila
                if (citas.some((x) => x.ini_minutos < b && b < x.fin_minutos)) {
                  return null;
                }

                // Bloque libre o pasado
                const past = esPasado(fecha, b + 30);
                return (
                  <li key={b} className="day-row">
                    <span className="day-row__t">
                      {hhmm(b)} – {hhmm(b + 30)}
                    </span>
                    <span>
                      <span className={`badge ${past ? 'badge--off' : 'badge--ok'}`}>
                        {past ? 'Pasado' : 'Libre'}
                      </span>
                    </span>
                    <span className="day-row__d">
                      {past ? 'Bloque sin uso' : 'Disponible para agendar'}
                    </span>
                    {past ? (
                      <span />
                    ) : (
                      <button
                        type="button"
                        className="text-button"
                        onClick={() => {
                          navigate(
                            `/inicio/citas?accion=nueva&sala=${id}&fecha=${fecha}&ini=${b}`,
                          );
                        }}
                      >
                        Agendar
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>
        </>
      )}

      <DetalleCitaDialog
        isOpen={Boolean(selectedCita)}
        cita={selectedCita}
        onClose={() => setSelectedCita(null)}
        salaIndex={salaIndex}
      />
    </div>
  );
}
