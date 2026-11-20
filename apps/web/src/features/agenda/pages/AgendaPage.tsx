import { useCallback, useMemo, useRef, useState } from 'react';
import FullCalendar from '@fullcalendar/react';
import dayGridPlugin from '@fullcalendar/daygrid';
import timeGridPlugin from '@fullcalendar/timegrid';
import interactionPlugin from '@fullcalendar/interaction';
import esLocale from '@fullcalendar/core/locales/es';
import {
  CalendarDays,
  CalendarPlus,
  CalendarX,
  ChevronLeft,
  ChevronRight,
  Info,
  Printer,
} from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import type { Session } from '../../auth/types';
import { useTherapistList } from '../../terapeutas/hooks/useTerapeutas';
import { fLarga, fMedia, getSalaColor } from '../../salas/validation';
import { CancelarCitaDialog } from '../../citas/components/CancelarCitaDialog';
import { DetalleCitaDialog } from '../../citas/components/DetalleCitaDialog';
import { citaKeys, useAgendaCitas, useSalasActivas } from '../../citas/hooks/useCitas';
import {
  BLOQUES_DEL_DIA,
  enHoraClinica,
  esDomingo,
  hoyEnClinica,
  minutosAHora,
  primerDiaHabilEnClinica,
  rangoDelPeriodo,
  rangoLegible,
  sumarDias,
  yaPaso,
} from '../../citas/horario';
import type { Cita } from '../../citas/types';
import '../../citas/styles/citas.css';

type VistaAgenda = 'dia' | 'semana' | 'mes';

const VISTAS_FC: Record<VistaAgenda, string> = {
  dia: 'timeGridDay',
  semana: 'timeGridWeek',
  mes: 'dayGridMonth',
};

const VISTAS_LABELS: Record<VistaAgenda, string> = {
  dia: 'Día',
  semana: 'Semana',
  mes: 'Mes',
};

const VISTAS_MOVER: Record<VistaAgenda, [string, string]> = {
  dia: ['Día anterior', 'Día siguiente'],
  semana: ['Semana anterior', 'Semana siguiente'],
  mes: ['Mes anterior', 'Mes siguiente'],
};

const MESES = [
  'enero',
  'febrero',
  'marzo',
  'abril',
  'mayo',
  'junio',
  'julio',
  'agosto',
  'septiembre',
  'octubre',
  'noviembre',
  'diciembre',
];

function mesTexto(fechaIso: string) {
  const m = Number(fechaIso.slice(5, 7)) - 1;
  return MESES[m] ?? '';
}

function calcularRango(vista: VistaAgenda, fecha: string): [string, string] {
  if (vista === 'dia') return [fecha, fecha];
  if (vista === 'semana') {
    const sem = rangoDelPeriodo('semana', fecha);
    if (!sem) return [fecha, fecha];
    // La semana laboral de la clínica va de lunes a sábado (5 días tras el lunes)
    return [sem.desde, sumarDias(sem.desde, 5)];
  }
  const mes = rangoDelPeriodo('mes', fecha);
  return mes ? [mes.desde, mes.hasta] : [fecha, fecha];
}

function rangoTexto(vista: VistaAgenda, fecha: string): string {
  if (vista === 'dia') return fLarga(fecha);
  const [desde, hasta] = calcularRango(vista, fecha);
  if (vista === 'mes') {
    const m = mesTexto(fecha);
    const y = fecha.slice(0, 4);
    return `${m.charAt(0).toUpperCase() + m.slice(1)} de ${y}`;
  }
  const diaD = Number(desde.slice(8));
  const diaH = Number(hasta.slice(8));
  const mesD = mesTexto(desde);
  const mesH = mesTexto(hasta);
  const anioH = hasta.slice(0, 4);
  if (mesD === mesH) {
    return `Semana del ${diaD} al ${diaH} de ${mesH} de ${anioH}`;
  }
  return `Semana del ${diaD} de ${mesD} al ${diaH} de ${mesH} de ${anioH}`;
}

export function AgendaPage({ session }: { session: Session }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const calendarRef = useRef<FullCalendar | null>(null);

  const hoy = hoyEnClinica();
  const ahora = useMemo(() => new Date(), []);
  const ahoraMinutos = enHoraClinica(ahora).minutos;

  const [vista, setVista] = useState<VistaAgenda>('semana');
  const [fecha, setFecha] = useState<string>(primerDiaHabilEnClinica());
  const [ocultas, setOcultas] = useState<Set<string>>(new Set());
  const [terapeutaId, setTerapeutaId] = useState<string>('');
  const [mostrarCanceladas, setMostrarCanceladas] = useState<boolean>(false);
  const [aviso, setAviso] = useState<string>('');

  const [selectedCita, setSelectedCita] = useState<Cita | null>(null);
  const [cancelingCita, setCancelingCita] = useState<Cita | null>(null);

  const [rangoDesde, rangoHasta] = useMemo(() => calcularRango(vista, fecha), [vista, fecha]);

  // Consultas
  const salasQuery = useSalasActivas(session.token);
  const terapeutasQuery = useTherapistList({ pagina: 1, tamano: 100 }, session.token);
  const agendaQuery = useAgendaCitas(
    {
      desde: rangoDesde,
      hasta: rangoHasta,
      id_terapeuta: terapeutaId || undefined,
      canceladas: mostrarCanceladas,
    },
    session.token,
  );

  const salas = useMemo(() => salasQuery.data?.salas ?? [], [salasQuery.data?.salas]);
  const terapeutas = terapeutasQuery.data?.datos ?? [];
  const citas = useMemo(() => agendaQuery.data ?? [], [agendaQuery.data]);

  // Mapeo salaId -> color
  const salaColorMap = useMemo(() => {
    const map = new Map<string, string>();
    salas.forEach((s, idx) => map.set(s.id, getSalaColor(idx)));
    return map;
  }, [salas]);

  // Citas filtradas por sala visible
  const citasFiltradas = useMemo(() => {
    return citas.filter((c) => {
      if (ocultas.has(c.sala.id)) return false;
      return true;
    });
  }, [citas, ocultas]);

  const citasMap = useMemo(() => {
    const map = new Map<string, Cita>();
    citasFiltradas.forEach((c) => map.set(c.id, c));
    return map;
  }, [citasFiltradas]);

  // Filtros activos
  const hayFiltros = ocultas.size > 0 || Boolean(terapeutaId) || mostrarCanceladas;

  const limpiarFiltros = () => {
    setOcultas(new Set());
    setTerapeutaId('');
    setMostrarCanceladas(false);
  };

  // Navegación de fechas
  const cambiarVista = (nuevaVista: VistaAgenda) => {
    setVista(nuevaVista);
    if (calendarRef.current) {
      calendarRef.current.getApi().changeView(VISTAS_FC[nuevaVista], fecha);
    }
  };

  const irAFecha = useCallback((nuevaFecha: string, mensajeAviso = '') => {
    let destino = nuevaFecha;
    let msg = mensajeAviso;
    if (esDomingo(nuevaFecha)) {
      destino = sumarDias(nuevaFecha, 1);
      msg = `La clínica no abre los domingos; se muestra el lunes ${Number(destino.slice(8))} de ${mesTexto(destino)}.`;
    }
    setFecha(destino);
    setAviso(msg);
    if (calendarRef.current) {
      calendarRef.current.getApi().gotoDate(destino);
    }
  }, []);

  const mover = (direccion: number) => {
    if (direccion === 0) {
      irAFecha(hoy);
      return;
    }
    if (calendarRef.current) {
      const api = calendarRef.current.getApi();
      if (direccion < 0) api.prev();
      else api.next();
      return;
    }
    const delta = vista === 'dia' ? 1 : vista === 'semana' ? 7 : 30;
    const nueva = sumarDias(fecha, direccion * delta);
    irAFecha(esDomingo(nueva) ? sumarDias(nueva, 1) : nueva);
  };

  // Eventos para FullCalendar
  const eventosFC = useMemo(() => {
    return citasFiltradas.map((ct) => {
      const color = salaColorMap.get(ct.sala.id) ?? '#002e5f';
      return {
        id: ct.id,
        title: ct.paciente.nombre_completo,
        start: ct.inicio,
        end: ct.fin,
        extendedProps: {
          cita: ct,
          salaColor: color,
        },
        classNames: [
          'ev',
          ct.estado === 'Vencida' ? 'is-venc' : '',
          ct.estado === 'Cancelada' ? 'is-canc' : '',
        ].filter(Boolean),
      };
    });
  }, [citasFiltradas, salaColorMap]);

  // Horarios del día seleccionado (bloques de 30 min)
  const bloquesDia = useMemo(() => {
    if (esDomingo(fecha)) return [];
    const citasDelDia = citasFiltradas.filter((c) => {
      const local = enHoraClinica(c.inicio);
      return local.fecha === fecha;
    });

    return BLOQUES_DEL_DIA.map((inicioMin) => {
      const finMin = inicioMin + 30;
      const citasEnBloque = citasDelDia.filter((c) => {
        const cIni = enHoraClinica(c.inicio).minutos;
        const cFin = enHoraClinica(c.fin).minutos;
        return cIni <= inicioMin && inicioMin < cFin;
      });
      const pasado = yaPaso(fecha, finMin, ahora);
      const esAhora = fecha === hoy && inicioMin <= ahoraMinutos && ahoraMinutos < finMin;

      return {
        inicioMin,
        finMin,
        citas: citasEnBloque,
        pasado,
        esAhora,
      };
    });
  }, [fecha, citasFiltradas, hoy, ahoraMinutos, ahora]);

  const horariosOcupadosCount = bloquesDia.filter((b) => b.citas.length > 0).length;
  const citasDiaUnicas = useMemo(() => {
    const ids = new Set(bloquesDia.flatMap((b) => b.citas.map((c) => c.id)));
    return ids.size;
  }, [bloquesDia]);

  const esHoyEnRango = hoy >= rangoDesde && hoy <= rangoHasta;
  const [moverAnt, moverSig] = VISTAS_MOVER[vista];

  const handleCitaCancelled = () => {
    setCancelingCita(null);
    setSelectedCita(null);
    void queryClient.invalidateQueries({
      queryKey: citaKeys.agenda({ desde: rangoDesde, hasta: rangoHasta }),
    });
    void queryClient.invalidateQueries({ queryKey: citaKeys.dashboard });
    void queryClient.invalidateQueries({ queryKey: citaKeys.listas });
  };

  const handlePrint = () => {
    calendarRef.current?.getApi().updateSize();
    window.print();
  };

  return (
    <div className="page page--wide">
      <div className="page-head">
        <div className="page-title">
          <span className="page-title__icon" aria-hidden="true">
            <CalendarDays size={22} />
          </span>
          <div>
            <h1>Agenda</h1>
            <p>Citas por día, semana o mes · Clínica SEAP</p>
          </div>
        </div>
        <div className="page-tools">
          <button
            type="button"
            className="button button--secondary"
            id="ag-print"
            onClick={handlePrint}
          >
            <Printer size={16} aria-hidden="true" />
            Imprimir agenda
          </button>
        </div>
      </div>

      {/* Encabezado de impresión (RF 6.2.4) */}
      <div className="print-head" id="ag-print-head">
        <div>
          <h1>Agenda · {rangoTexto(vista, fecha)}</h1>
          <p>
            {hayFiltros ? 'Con filtros aplicados' : 'Todas las salas'} · {citasFiltradas.length}{' '}
            {citasFiltradas.length === 1 ? 'cita' : 'citas'}
          </p>
        </div>
        <p>
          PsicoGestión · Clínica SEAP
          <br />
          Impreso el {fMedia(hoy)} a las {minutosAHora(ahoraMinutos)}
        </p>
      </div>

      <div className="agenda agenda--page" id="agenda" data-vista={vista}>
        {/* Columna Principal: Calendario */}
        <section className="panel ag-main" aria-labelledby="ag-t">
          {/* Barra de navegación de fecha y selector de vista (RF 6.1.2) */}
          <div className="toolbar ag-bar">
            <h2 className="sr-only" id="ag-t">
              Agenda
            </h2>

            <div className="datebar" role="group" aria-label="Mover la agenda">
              <button
                type="button"
                data-agmove="-1"
                aria-label={moverAnt}
                title={moverAnt}
                onClick={() => mover(-1)}
              >
                <ChevronLeft size={16} aria-hidden="true" />
              </button>
              <button
                type="button"
                data-agmove="0"
                className={esHoyEnRango ? 'is-on' : ''}
                onClick={() => mover(0)}
              >
                Hoy
              </button>
              <button
                type="button"
                data-agmove="1"
                aria-label={moverSig}
                title={moverSig}
                onClick={() => mover(1)}
              >
                <ChevronRight size={16} aria-hidden="true" />
              </button>
              <label className="sr-only" htmlFor="ag-fecha">
                Ir a una fecha
              </label>
              <input
                type="date"
                id="ag-fecha"
                value={fecha}
                onChange={(e) => {
                  if (e.target.value) irAFecha(e.target.value);
                }}
              />
            </div>

            <p className="range-label" id="ag-range" aria-live="polite">
              {rangoTexto(vista, fecha)}
              <small>
                {citasFiltradas.length} {citasFiltradas.length === 1 ? 'cita' : 'citas'}
                {hayFiltros ? ' con los filtros aplicados' : ''}
              </small>
            </p>

            <span className="toolbar__spacer" />

            <div className="segmented" role="group" aria-label="Vista de la agenda">
              {(['dia', 'semana', 'mes'] as const).map((v) => (
                <button
                  key={v}
                  type="button"
                  data-agvista={v}
                  aria-pressed={vista === v}
                  onClick={() => cambiarVista(v)}
                >
                  {VISTAS_LABELS[v]}
                </button>
              ))}
            </div>
          </div>

          {/* Filtros: Salas, Terapeuta, Canceladas */}
          <div className="ag-filters" id="ag-filters">
            <span className="ag-filters__label" id="ag-fl">
              Salas
            </span>
            <div className="ag-filters__chips" role="group" aria-labelledby="ag-fl">
              {salas.map((s, idx) => {
                const color = getSalaColor(idx);
                const activa = !ocultas.has(s.id);
                const count = citas.filter((c) => c.sala.id === s.id).length;
                return (
                  <button
                    key={s.id}
                    type="button"
                    className="room-chip"
                    style={{ '--c': color } as React.CSSProperties}
                    data-agsala={s.id}
                    aria-pressed={activa}
                    title={`${activa ? 'Ocultar' : 'Mostrar'} ${s.nombre}`}
                    onClick={() => {
                      setOcultas((prev) => {
                        const next = new Set(prev);
                        if (next.has(s.id)) next.delete(s.id);
                        else next.add(s.id);
                        return next;
                      });
                    }}
                  >
                    <i className="dot" aria-hidden="true" />
                    {s.nombre}
                    <small>{count}</small>
                  </button>
                );
              })}
            </div>

            <label className="sr-only" htmlFor="ag-ter">
              Terapeuta
            </label>
            <select
              id="ag-ter"
              className="ag-select"
              value={terapeutaId}
              onChange={(e) => setTerapeutaId(e.target.value)}
            >
              <option value="">Todos los terapeutas</option>
              {terapeutas.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.nombre_completo}
                  {t.activo ? '' : ' (baja)'}
                </option>
              ))}
            </select>

            <label className="ag-check">
              <input
                type="checkbox"
                id="ag-canc"
                checked={mostrarCanceladas}
                onChange={(e) => setMostrarCanceladas(e.target.checked)}
              />
              Mostrar canceladas
            </label>

            {hayFiltros && (
              <button type="button" className="text-button" id="ag-clear" onClick={limpiarFiltros}>
                Quitar filtros
              </button>
            )}
          </div>

          {/* Avisos */}
          {aviso && (
            <div className="ag-note">
              <Info size={15} aria-hidden="true" />
              <span>{aviso}</span>
            </div>
          )}

          {citasFiltradas.length === 0 && !aviso && (
            <div className="ag-note">
              <CalendarX size={15} aria-hidden="true" />
              <span>
                No hay citas{' '}
                {vista === 'dia' ? 'este día' : vista === 'semana' ? 'esta semana' : 'este mes'}
                {hayFiltros ? ' con los filtros aplicados.' : '. Todos los horarios están libres.'}
              </span>
              {hayFiltros && (
                <button type="button" className="text-button" onClick={limpiarFiltros}>
                  Quitar filtros
                </button>
              )}
            </div>
          )}

          {/* FullCalendar Component */}
          <div className="ag-cal" id="ag-cal">
            <FullCalendar
              ref={calendarRef}
              plugins={[dayGridPlugin, timeGridPlugin, interactionPlugin]}
              initialView={VISTAS_FC[vista]}
              initialDate={fecha}
              locale={esLocale}
              firstDay={1}
              hiddenDays={[0]} // Desactiva y oculta los domingos (RF 6.2)
              allDaySlot={false}
              slotMinTime="07:00:00"
              slotMaxTime="17:00:00"
              slotDuration="00:30:00"
              slotLabelInterval="01:00"
              slotLabelFormat={{ hour: '2-digit', minute: '2-digit', hour12: false }}
              eventTimeFormat={{ hour: '2-digit', minute: '2-digit', hour12: false }}
              views={{
                timeGridDay: {
                  dayHeaderFormat: { weekday: 'long', day: 'numeric', month: 'long' },
                },
                timeGridWeek: {
                  dayHeaderFormat: { weekday: 'short', day: 'numeric' },
                  eventMaxStack: 2,
                },
                dayGridMonth: {
                  dayHeaderFormat: { weekday: 'short' },
                  eventDisplay: 'block',
                },
              }}
              headerToolbar={false}
              height="auto"
              fixedWeekCount={false}
              nowIndicator={true}
              now={`${hoy}T${minutosAHora(ahoraMinutos)}:00`}
              dayMaxEvents={3}
              eventMaxStack={3}
              moreLinkClick="popover"
              navLinks={true}
              navLinkDayClick={(date) => {
                const iso = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
                setFecha(iso);
                cambiarVista('dia');
              }}
              dateClick={(info) => {
                const iso = info.dateStr.slice(0, 10);
                if (!esDomingo(iso)) {
                  setFecha(iso);
                }
              }}
              events={eventosFC}
              eventContent={(arg) => {
                const ct = arg.event.extendedProps.cita as Cita | undefined;
                if (!ct) return null;
                const iniMin = enHoraClinica(ct.inicio).minutos;
                const finMin = enHoraClinica(ct.fin).minutos;
                const pac = ct.paciente.nombre_completo;
                const ter = ct.terapeuta.nombre_completo;
                const sala = ct.sala.nombre;

                if (arg.view.type === 'dayGridMonth') {
                  return (
                    <div className="ev-m">
                      <b>{minutosAHora(iniMin)}</b>
                      <span>{pac}</span>
                    </div>
                  );
                }

                return (
                  <div className="ev-c">
                    <span className="ev-c__time">
                      {minutosAHora(iniMin)}–{minutosAHora(finMin)} · {sala}
                    </span>
                    <span className="ev-c__pac">{pac}</span>
                    <span className="ev-c__meta">{ter}</span>
                  </div>
                );
              }}
              eventDidMount={(info) => {
                const color = (info.event.extendedProps.salaColor as string) || '#002e5f';
                info.el.style.setProperty('--ev', color);
                info.el.setAttribute('role', 'button');
                info.el.setAttribute('tabindex', '0');
              }}
              eventClick={(info) => {
                info.jsEvent.preventDefault();
                const ct = citasMap.get(info.event.id);
                if (ct) setSelectedCita(ct);
              }}
              datesSet={(info) => {
                const startIso = `${info.view.currentStart.getFullYear()}-${String(info.view.currentStart.getMonth() + 1).padStart(2, '0')}-${String(info.view.currentStart.getDate()).padStart(2, '0')}`;
                if (info.view.type === 'timeGridDay') {
                  setFecha(startIso);
                  return;
                }
                // Semana y mes: al usar las flechas del calendario, `fecha` debe seguir al rango
                // visible para que el título y la consulta de citas se actualicen (DEF-ITER04).
                const e = info.view.currentEnd;
                const endIso = `${e.getFullYear()}-${String(e.getMonth() + 1).padStart(2, '0')}-${String(e.getDate()).padStart(2, '0')}`;
                setFecha((prev) => {
                  if (prev >= startIso && prev < endIso) return prev;
                  if (hoy >= startIso && hoy < endIso) return hoy;
                  return esDomingo(startIso) ? sumarDias(startIso, 1) : startIso;
                });
              }}
            />
          </div>

          {/* Leyenda */}
          <div className="legend ag-legend">
            <span>
              <i className="l-pend" aria-hidden="true" />
              Pendiente
            </span>
            <span>
              <i className="l-venc" aria-hidden="true" />
              Vencida
            </span>
            {mostrarCanceladas && (
              <span id="lg-canc">
                <i className="l-canc" aria-hidden="true" />
                Cancelada
              </span>
            )}
          </div>

          <p className="ag-hint">
            <Info size={13} aria-hidden="true" />
            El color indica la sala. Clic en un día para ver sus horarios; en una cita, para ver el
            detalle.
          </p>
        </section>

        {/* Columna Lateral: Horarios del Día (RF 6.2.2, RF 6.2.3) */}
        <aside className="panel ag-day" id="ag-day" aria-labelledby="hd-t">
          <div className="ag-day__head">
            <h2 className="panel__title" id="hd-t">
              Horarios del día
            </h2>
            <p className="ag-day__date">
              {fLarga(fecha)}
              {fecha === hoy ? (
                <>
                  {' '}
                  <span className="badge badge--res">Hoy</span>
                </>
              ) : null}
            </p>
            <p className="ag-day__sum">
              {esDomingo(fecha) ? (
                'La clínica no abre los domingos.'
              ) : (
                <>
                  <b>{horariosOcupadosCount}</b> de {bloquesDia.length} horarios ocupados ·{' '}
                  {citasDiaUnicas} {citasDiaUnicas === 1 ? 'cita' : 'citas'}
                </>
              )}
            </p>
          </div>

          {esDomingo(fecha) ? (
            <div className="ag-note" style={{ margin: '1rem' }}>
              <Info size={15} aria-hidden="true" />
              <span>La clínica no atiende los domingos. Elige un día de lunes a sábado.</span>
            </div>
          ) : (
            <ol className="hr-list" aria-label="Horarios de 30 minutos de 7:00 a 17:00">
              {bloquesDia.map((bloque) => {
                const ocupado = bloque.citas.length > 0;
                return (
                  <li
                    key={bloque.inicioMin}
                    className={`hr${ocupado ? ' is-busy' : ''}${bloque.pasado ? ' is-past' : ''}${bloque.esAhora ? ' is-now' : ''}`}
                  >
                    <span className="hr__t">
                      {minutosAHora(bloque.inicioMin)}
                      <small>{minutosAHora(bloque.finMin)}</small>
                      {bloque.esAhora && <span className="badge badge--res hr__now">Ahora</span>}
                    </span>
                    <div className="hr__body">
                      {ocupado ? (
                        bloque.citas.map((c) => {
                          const color = salaColorMap.get(c.sala.id) ?? '#002e5f';
                          const localIni = enHoraClinica(c.inicio).minutos;
                          const continua = localIni !== bloque.inicioMin;

                          return (
                            <button
                              key={c.id}
                              type="button"
                              className={`hr__c${c.estado === 'Vencida' ? ' is-venc' : ''}`}
                              style={{ '--ev': color } as React.CSSProperties}
                              data-cita={c.id}
                              aria-label={`${c.sala.nombre}: ${c.paciente.nombre_completo} con ${c.terapeuta.nombre_completo}, ${rangoLegible(c.inicio, c.fin)}${continua ? ' (continúa)' : ''}`}
                              onClick={() => setSelectedCita(c)}
                            >
                              <span className="hr__s">
                                {c.sala.nombre}
                                {continua ? ' · continúa' : ''}
                              </span>
                              <span className="hr__p">{c.paciente.nombre_completo}</span>
                              <span className="hr__m">{c.terapeuta.nombre_completo}</span>
                            </button>
                          );
                        })
                      ) : (
                        <span className="hr__free">
                          {bloque.pasado ? 'Libre · ya pasó' : 'Libre'}
                        </span>
                      )}
                    </div>
                  </li>
                );
              })}
            </ol>
          )}
        </aside>
      </div>

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
    </div>
  );
}
