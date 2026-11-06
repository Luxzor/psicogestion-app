import { useMemo, useState } from 'react';
import {
  ArrowRight,
  CalendarCheck,
  CalendarDays,
  CalendarPlus,
  DoorOpen,
  Home,
  LoaderCircle,
  Users,
  UserSquare2,
} from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import type { Session } from '../../auth/types';
import { fLarga, getSalaColor } from '../../salas/validation';
import { CancelarCitaDialog } from '../../citas/components/CancelarCitaDialog';
import { DetalleCitaDialog } from '../../citas/components/DetalleCitaDialog';
import { EstadoBadge } from '../../citas/components/EstadoBadge';
import { citaKeys, useDashboardSummary, useSalasActivas } from '../../citas/hooks/useCitas';
import { enHoraClinica, hoyEnClinica, minutosAHora, yaPaso } from '../../citas/horario';
import type { Cita } from '../../citas/types';
import { useUnsavedChanges } from '../../../contexts/UnsavedChangesContext';
import '../../citas/styles/citas.css';

/**
 * RF 7.1.1, RF 7.2.1–7.2.6 (EDT 5.3.3, maqueta PG-DSN-003-INT).
 * Pantalla de inicio con KPIs rápidos, lista de citas de hoy, acceso a módulos y FAB.
 */
export function DashboardHomePage({ session }: { session: Session }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { hasUnsavedChanges, setHasUnsavedChanges } = useUnsavedChanges();

  const hoy = hoyEnClinica();
  const ahora = new Date();
  const ahoraMinutos = enHoraClinica(ahora).minutos;

  const summaryQuery = useDashboardSummary(session.token);
  const salasQuery = useSalasActivas(session.token);

  const [selectedCita, setSelectedCita] = useState<Cita | null>(null);
  const [cancelingCita, setCancelingCita] = useState<Cita | null>(null);

  const summary = summaryQuery.data;
  const salas = useMemo(() => salasQuery.data?.salas ?? [], [salasQuery.data?.salas]);

  // Mapeo salaId -> color consistente con el selector y la agenda
  const salaColorMap = useMemo(() => {
    const map = new Map<string, string>();
    salas.forEach((s, idx) => map.set(s.id, getSalaColor(idx)));
    return map;
  }, [salas]);

  const nombreCompleto = session.user?.nombre_completo ?? 'Usuario';
  const primerNombre = nombreCompleto.split(' ')[0] ?? 'Usuario';

  const citasHoy = useMemo(() => summary?.citas_hoy ?? [], [summary?.citas_hoy]);
  const pendHoy = summary?.citas_pendientes_hoy ?? 0;
  const prox = useMemo(() => {
    return citasHoy.find((c) => {
      if (c.estado !== 'Pendiente') return false;
      const finMin = enHoraClinica(c.fin).minutos;
      return finMin > ahoraMinutos;
    });
  }, [citasHoy, ahoraMinutos]);

  const handleCitaCancelled = () => {
    setCancelingCita(null);
    setSelectedCita(null);
    void queryClient.invalidateQueries({ queryKey: citaKeys.dashboard });
    void queryClient.invalidateQueries({ queryKey: citaKeys.listas });
  };

  return (
    <div className="page page--wide">
      <div className="page-head">
        <div className="page-title">
          <span className="page-title__icon" aria-hidden="true">
            <Home size={22} />
          </span>
          <div>
            <h1>¡Hola, {primerNombre}!</h1>
            <p>{fLarga(hoy)} · Clínica SEAP</p>
          </div>
        </div>
      </div>

      {/* Accesos rápidos / KPIs (RF 7.2.1–7.2.5) */}
      <nav className="quick" aria-label="Accesos rápidos">
        <Link to="/inicio/citas" className="quick__card" data-nav="citas">
          <span className="quick__icon" aria-hidden="true">
            <CalendarCheck size={22} />
          </span>
          <span className="quick__body">
            <span className="quick__label">Citas</span>
            <span className="quick__num">{summary?.citas_pendientes_total ?? 0}</span>
            <span className="quick__desc">pendientes en total</span>
          </span>
          <span className="quick__go" aria-hidden="true">
            <ArrowRight size={16} />
          </span>
        </Link>

        <Link to="/inicio/salas" className="quick__card" data-nav="salas">
          <span className="quick__icon" aria-hidden="true">
            <DoorOpen size={22} />
          </span>
          <span className="quick__body">
            <span className="quick__label">Salas</span>
            <span className="quick__num">{summary?.salas_totales ?? 0}</span>
            <span className="quick__desc">
              registradas · {summary?.salas_libres_hoy ?? 0} libres hoy
            </span>
          </span>
          <span className="quick__go" aria-hidden="true">
            <ArrowRight size={16} />
          </span>
        </Link>

        <Link to="/inicio/pacientes" className="quick__card" data-nav="pac">
          <span className="quick__icon" aria-hidden="true">
            <Users size={22} />
          </span>
          <span className="quick__body">
            <span className="quick__label">Pacientes</span>
            <span className="quick__num">{summary?.pacientes_totales ?? 0}</span>
            <span className="quick__desc">registrados</span>
          </span>
          <span className="quick__go" aria-hidden="true">
            <ArrowRight size={16} />
          </span>
        </Link>

        <Link to="/inicio/terapeutas" className="quick__card" data-nav="ter">
          <span className="quick__icon" aria-hidden="true">
            <UserSquare2 size={22} />
          </span>
          <span className="quick__body">
            <span className="quick__label">Terapeutas</span>
            <span className="quick__num">{summary?.terapeutas_activos ?? 0}</span>
            <span className="quick__desc">activos</span>
          </span>
          <span className="quick__go" aria-hidden="true">
            <ArrowRight size={16} />
          </span>
        </Link>
      </nav>

      {/* Panel Citas de hoy (RF 7.1.1) */}
      <section className="panel today" aria-labelledby="t-hoy">
        <div className="today__head">
          <div>
            <h2 id="t-hoy">Citas de hoy</h2>
            <p>
              {pendHoy} {pendHoy === 1 ? 'pendiente' : 'pendientes'} de {citasHoy.length}{' '}
              {citasHoy.length === 1 ? 'programada' : 'programadas'}
            </p>
          </div>
          <button
            type="button"
            className="text-button"
            id="ver-hoy"
            onClick={() => navigate(`/inicio/citas?periodo=dia&fecha=${hoy}`)}
          >
            Ver en Citas
            <ArrowRight size={14} aria-hidden="true" />
          </button>
        </div>

        {summaryQuery.isPending ? (
          <div className="times-skel" aria-label="Cargando citas de hoy">
            <LoaderCircle size={20} className="spin" aria-hidden="true" />
            <span>Consultando citas de hoy...</span>
          </div>
        ) : citasHoy.length === 0 ? (
          <div className="empty">
            <span className="empty__icon" aria-hidden="true">
              <CalendarDays size={40} />
            </span>
            <h2>No hay citas para hoy</h2>
            <p>Cuando se agende una cita para hoy aparecerá aquí.</p>
          </div>
        ) : (
          <ul className="today__list">
            {citasHoy.map((c) => {
              const finMin = enHoraClinica(c.fin).minutos;
              const iniMin = enHoraClinica(c.inicio).minutos;
              const pas = yaPaso(hoy, finMin, ahora);
              const esProx = prox?.id === c.id;
              const color = salaColorMap.get(c.sala.id) ?? '#002e5f';

              return (
                <li key={c.id}>
                  <button
                    type="button"
                    className={`today__row${pas ? ' is-past' : ''}${esProx ? ' is-next' : ''}`}
                    onClick={() => setSelectedCita(c)}
                    aria-label={`Ver cita ${c.folio}`}
                  >
                    <span className="today__time">
                      <b>{minutosAHora(iniMin)}</b>
                      <span>{minutosAHora(finMin)}</span>
                    </span>
                    <span className="today__who">
                      <b>{c.paciente.nombre_completo}</b>
                      <span>{c.terapeuta.nombre_completo}</span>
                    </span>
                    <span className="room-name">
                      <span className="dot" style={{ '--c': color } as React.CSSProperties} />
                      {c.sala.nombre}
                    </span>
                    <span className="today__st">
                      {esProx ? <span className="badge badge--res">Siguiente</span> : null}
                      <EstadoBadge estado={c.estado} />
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* FAB: Agendar cita */}
      <Link
        to="/inicio/citas/nueva"
        className="button button--primary fab"
        id="fab"
        aria-label="Agendar cita"
      >
        <CalendarPlus size={18} aria-hidden="true" />
        Agendar cita
      </Link>

      {/* Diálogos interactivos */}
      <DetalleCitaDialog
        isOpen={Boolean(selectedCita)}
        cita={selectedCita}
        onClose={() => setSelectedCita(null)}
        onEditar={(cita: Cita) => {
          setSelectedCita(null);
          navigate(`/inicio/citas/${cita.id}/editar`);
        }}
        onCancelar={(cita: Cita) => {
          setCancelingCita(cita);
        }}
      />

      <CancelarCitaDialog
        isOpen={Boolean(cancelingCita)}
        cita={cancelingCita}
        accessToken={session.token}
        onClose={() => setCancelingCita(null)}
        onCanceled={handleCitaCancelled}
      />

      {/* Toggle utilitario para pruebas de UnsavedChanges */}
      <div style={{ display: 'none' }}>
        <input
          type="checkbox"
          id="unsaved-toggle"
          checked={hasUnsavedChanges}
          onChange={(e) => setHasUnsavedChanges(e.target.checked)}
        />
      </div>
    </div>
  );
}
