import { useCallback, useEffect, useState, type KeyboardEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  CalendarCheck,
  CalendarDays,
  CalendarPlus,
  CalendarX,
  ChevronLeft,
  ChevronRight,
  CircleCheck,
  CircleX,
  Clock,
  Hash,
  RotateCw,
  Search,
  WifiOff,
  X,
} from 'lucide-react';
import { Link, useSearchParams } from 'react-router-dom';
import type { Session } from '../../auth/types';
import { useTherapistList } from '../../terapeutas/hooks/useTerapeutas';
import { fLarga, fMedia, getSalaColor } from '../../salas/validation';
import { CancelarCitaDialog } from '../components/CancelarCitaDialog';
import { CancelarPorFolioDialog } from '../components/CancelarPorFolioDialog';
import { DetalleCitaDialog } from '../components/DetalleCitaDialog';
import { citaKeys, useCitaList, useSalasActivas } from '../hooks/useCitas';
import {
  enHoraClinica,
  hoyEnClinica,
  rangoDelPeriodo,
  rangoLegible,
  sumarDias,
} from '../horario';
import type { Cita, CitaEstado, CitaListParams } from '../types';
import { CITA_TABS, normalizeFolio, validateFolio } from '../validation';
import '../../pacientes/styles/pacientes.css';
import '../styles/citas.css';

const PAGE_SIZE = 25;
const SEARCH_DELAY_MS = 300;
const SKELETON_ROWS = 5;
const THERAPIST_PAGE_SIZE = 100;

const PERIODOS: ReadonlyArray<{ value: 'todo' | 'dia' | 'semana' | 'mes'; label: string }> = [
  { value: 'todo', label: 'Todo' },
  { value: 'dia', label: 'Día' },
  { value: 'semana', label: 'Semana' },
  { value: 'mes', label: 'Mes' },
];

const ESTADO_VACIO: Record<CitaEstado, string> = {
  Pendiente: 'No hay citas pendientes.',
  Cancelada: 'No hay citas canceladas.',
  Vencida: 'No hay citas vencidas.',
};

function readEstado(value: string | null): CitaEstado {
  const match = CITA_TABS.find((tab) => tab.estado === value);
  return match ? match.estado : 'Pendiente';
}

function readPeriodo(value: string | null): 'todo' | 'dia' | 'semana' | 'mes' {
  return value === 'dia' || value === 'semana' || value === 'mes' ? value : 'todo';
}

function sumarMeses(fecha: string, delta: number) {
  const [year, month] = fecha.split('-').map(Number);
  const d = new Date(Date.UTC(year, month - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-01`;
}

function periodoTexto(periodo: string, fecha: string) {
  if (periodo === 'dia') return fLarga(fecha);
  if (periodo === 'semana') {
    const rango = rangoDelPeriodo('semana', fecha);
    if (!rango) return '';
    return `Semana del ${fMedia(rango.desde).toLowerCase()} al ${fMedia(rango.hasta).toLowerCase()}`;
  }
  if (periodo === 'mes') {
    const [year, month] = fecha.split('-').map(Number);
    const d = new Date(Date.UTC(year, month - 1, 1));
    const mesNombre = d.toLocaleDateString('es-MX', { month: 'long', timeZone: 'UTC' });
    return `${mesNombre.charAt(0).toUpperCase() + mesNombre.slice(1)} de ${d.getUTCFullYear()}`;
  }
  return '';
}

function esPeriodoActual(periodo: string, fecha: string) {
  const hoy = hoyEnClinica();
  if (periodo === 'semana') {
    const r1 = rangoDelPeriodo('semana', fecha);
    const r2 = rangoDelPeriodo('semana', hoy);
    return r1?.desde === r2?.desde;
  }
  if (periodo === 'mes') {
    return fecha.slice(0, 7) === hoy.slice(0, 7);
  }
  return fecha === hoy;
}

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

/**
 * RF 5.2.1–5.2.3, RF 5.4.1–5.4.4 (EDT 5.3.3 y 5.3.5).
 * Lista de citas y detalle interactivo mediante diálogo (PG-DSN-003-INT).
 */
export function CitasPage({ session }: { session: Session }) {
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();

  const estado = readEstado(searchParams.get('estado'));
  const idSala = searchParams.get('sala') ?? '';
  const idTerapeuta = searchParams.get('terapeuta') ?? '';
  const periodo = readPeriodo(searchParams.get('periodo'));
  const fecha = searchParams.get('fecha') || hoyEnClinica();
  const folio = searchParams.get('folio') ?? '';
  const pagina = Math.max(1, Number(searchParams.get('pagina')) || 1);

  const [folioInput, setFolioInput] = useState(folio);
  const [isFolioModalOpen, setIsFolioModalOpen] = useState(false);
  const [citaParaDetalle, setCitaParaDetalle] = useState<Cita | null>(null);
  const [citaParaCancelar, setCitaParaCancelar] = useState<Cita | null>(null);
  const [flashMessage, setFlashMessage] = useState<string | null>(null);

  const updateParams = useCallback(
    (patch: Record<string, string | null>, options: { resetPagina?: boolean } = {}) => {
      setSearchParams(
        (current) => {
          const next = new URLSearchParams(current);
          for (const [key, value] of Object.entries(patch)) {
            if (!value) next.delete(key);
            else next.set(key, value);
          }
          if (options.resetPagina) next.delete('pagina');
          return next;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );

  // Búsqueda por folio con pausa de 300 ms
  useEffect(() => {
    const timer = setTimeout(() => {
      const valido = folioInput.trim() !== '' && !validateFolio(folioInput);
      updateParams({ folio: valido ? normalizeFolio(folioInput) : null }, { resetPagina: true });
    }, SEARCH_DELAY_MS);
    return () => clearTimeout(timer);
  }, [folioInput, updateParams]);

  const rango = rangoDelPeriodo(periodo, fecha);
  const listParams: CitaListParams = {
    estado,
    id_sala: idSala || undefined,
    id_terapeuta: idTerapeuta || undefined,
    desde: rango?.desde,
    hasta: rango?.hasta,
    folio: folio || undefined,
    pagina,
    tamano: PAGE_SIZE,
  };
  const list = useCitaList(listParams, session.token);
  const salas = useSalasActivas(session.token);
  const terapeutas = useTherapistList({ pagina: 1, tamano: THERAPIST_PAGE_SIZE }, session.token);

  const datos = list.data?.datos ?? [];
  const total = list.data?.total ?? 0;
  const desde = total === 0 ? 0 : (pagina - 1) * PAGE_SIZE + 1;
  const hasta = Math.min(pagina * PAGE_SIZE, total);
  const ultimaPagina = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const filtrosActivos = Boolean(idSala || idTerapeuta || periodo !== 'todo' || folio);
  const folioErrorVisible = folioInput.trim() !== '' && Boolean(validateFolio(folioInput));

  function onRowKeyDown(event: KeyboardEvent<HTMLTableRowElement>, item: Cita) {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    setCitaParaDetalle(item);
  }

  function limpiarFiltros() {
    setFolioInput('');
    updateParams(
      { sala: null, terapeuta: null, periodo: null, fecha: null, folio: null },
      { resetPagina: true },
    );
  }

  const getSalaIdx = (salaId: string) =>
    (salas.data?.salas ?? []).findIndex((s) => s.id === salaId);

  return (
    <div className="page page--wide">
      <div className="page-head">
        <div className="page-title">
          <span className="page-title__icon">
            <CalendarCheck size={22} aria-hidden="true" />
          </span>
          <div>
            <h1>Citas</h1>
            <p id="list-count">
              {list.isPending
                ? 'Buscando citas...'
                : `${total} ${total === 1 ? 'cita' : 'citas'} ${estado.toLowerCase()}${total === 1 ? '' : 's'}`}
            </p>
          </div>
        </div>
        <div className="page-tools">
          <div className="search" role="search">
            <Search size={16} aria-hidden="true" />
            <input
              type="search"
              id="q"
              value={folioInput}
              onChange={(event) => setFolioInput(event.target.value)}
              placeholder="Buscar por folio o paciente"
              aria-label="Buscar por folio"
              aria-describedby="buscar-folio-hint"
              autoComplete="off"
            />
            {folioInput ? (
              <button
                type="button"
                className="search__clear"
                id="q-clear"
                onClick={() => setFolioInput('')}
                aria-label="Limpiar búsqueda"
              >
                <X size={14} aria-hidden="true" />
              </button>
            ) : null}
          </div>
          <button
            type="button"
            className="button button--danger-soft"
            id="btn-folio"
            onClick={() => setIsFolioModalOpen(true)}
          >
            <Hash size={16} aria-hidden="true" />
            Cancelar por folio
          </button>
        </div>
      </div>

      <span
        className="field-hint citas-filtros__folio-hint"
        id="buscar-folio-hint"
        hidden={!folioErrorVisible}
      >
        {validateFolio(folioInput)}
      </span>

      {flashMessage ? (
        <div id="flash-slot">
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
        </div>
      ) : null}

      <section className="panel" id="citas-panel" role="tabpanel" aria-labelledby={`tab-${estado}`}>
        <div className="tabs" role="tablist" aria-label="Estatus de la cita" id="tabs">
          {CITA_TABS.map((tab) => (
            <button
              key={tab.estado}
              type="button"
              role="tab"
              id={`tab-${tab.estado}`}
              aria-selected={estado === tab.estado}
              aria-controls="citas-panel"
              className={`tab${estado === tab.estado ? ' is-active' : ''}`}
              onClick={() => updateParams({ estado: tab.estado }, { resetPagina: true })}
            >
              {tab.label}
              {estado === tab.estado && !list.isPending ? (
                <span className="count">{total}</span>
              ) : null}
            </button>
          ))}
        </div>

        <div className="filters">
          <label className="field">
            Sala
            <select
              id="f-sala"
              aria-label="Filtrar por sala"
              value={idSala}
              onChange={(event) =>
                updateParams({ sala: event.target.value || null }, { resetPagina: true })
              }
            >
              <option value="">Todas las salas</option>
              {(salas.data?.salas ?? []).map((sala) => (
                <option key={sala.id} value={sala.id}>
                  {sala.nombre}
                  {sala.activo === false ? ' (dada de baja)' : ''}
                </option>
              ))}
            </select>
          </label>

          <label className="field">
            Terapeuta
            <select
              id="f-ter"
              aria-label="Filtrar por terapeuta"
              value={idTerapeuta}
              onChange={(event) =>
                updateParams({ terapeuta: event.target.value || null }, { resetPagina: true })
              }
            >
              <option value="">Todos los terapeutas</option>
              {(terapeutas.data?.datos ?? []).map((terapeuta) => (
                <option key={terapeuta.id} value={terapeuta.id}>
                  {terapeuta.nombre_completo}
                  {terapeuta.activo === false ? ' (dado de baja)' : ''}
                </option>
              ))}
            </select>
          </label>

          <div className="field">
            <span>Periodo</span>
            <div className="segmented" role="group" aria-label="Periodo">
              {PERIODOS.map((item) => (
                <button
                  key={item.value}
                  type="button"
                  data-per={item.value}
                  aria-pressed={periodo === item.value}
                  onClick={() =>
                    updateParams(
                      { periodo: item.value === 'todo' ? null : item.value },
                      { resetPagina: true },
                    )
                  }
                >
                  {item.label}
                </button>
              ))}
            </div>
          </div>

          <button
            type="button"
            className="text-button filters__clear"
            id="f-clear"
            onClick={limpiarFiltros}
          >
            Limpiar filtros
          </button>
        </div>

        {periodo !== 'todo' ? (
          <div className="period-bar" id="period-bar" aria-live="polite">
            {periodo === 'semana' || periodo === 'mes' ? (
              <div className="datebar">
                <button
                  type="button"
                  aria-label={`${periodo === 'semana' ? 'Semana' : 'Mes'} anterior`}
                  onClick={() =>
                    updateParams(
                      {
                        fecha:
                          periodo === 'semana'
                            ? sumarDias(fecha, -7)
                            : sumarMeses(fecha, -1),
                      },
                      { resetPagina: true },
                    )
                  }
                >
                  <ChevronLeft size={16} aria-hidden="true" />
                </button>
                <button
                  type="button"
                  aria-label={`${periodo === 'semana' ? 'Semana' : 'Mes'} siguiente`}
                  onClick={() =>
                    updateParams(
                      {
                        fecha:
                          periodo === 'semana'
                            ? sumarDias(fecha, 7)
                            : sumarMeses(fecha, 1),
                      },
                      { resetPagina: true },
                    )
                  }
                >
                  <ChevronRight size={16} aria-hidden="true" />
                </button>
              </div>
            ) : null}

            <label className="period-bar__date">
              <span className="sr-only">Fecha del periodo</span>
              <input
                type="date"
                id="f-fecha"
                aria-label="Fecha de referencia del periodo"
                value={fecha}
                onChange={(event) =>
                  updateParams({ fecha: event.target.value || null }, { resetPagina: true })
                }
              />
            </label>

            <span className="period-bar__txt">
              <CalendarDays size={15} aria-hidden="true" />
              <span>
                <span className="sr-only">Periodo aplicado: </span>
                {periodoTexto(periodo, fecha)}
              </span>
            </span>

            {periodo !== 'dia' && !esPeriodoActual(periodo, fecha) ? (
              <button
                type="button"
                className="text-button"
                onClick={() => updateParams({ fecha: hoyEnClinica() }, { resetPagina: true })}
              >
                Ir a {periodo === 'semana' ? 'esta semana' : 'este mes'}
              </button>
            ) : null}
          </div>
        ) : null}

        <div aria-live="polite" className="sr-only">
          {list.isSuccess ? `${total} citas ${estado.toLowerCase()}s encontradas.` : ''}
        </div>

        {list.isError ? (
          <div className="empty" role="alert">
            <span className="empty__icon">
              <WifiOff size={44} aria-hidden="true" />
            </span>
            <h2>No pudimos cargar las citas</h2>
            <p>Revisa tu conexión e inténtalo de nuevo.</p>
            <button
              type="button"
              className="button button--primary"
              onClick={() => void list.refetch()}
            >
              <RotateCw size={15} aria-hidden="true" />
              Reintentar
            </button>
          </div>
        ) : list.isPending ? (
          <table className="data-table">
            <caption className="sr-only">Cargando citas</caption>
            <thead>
              <tr>
                <th scope="col">Folio</th>
                <th scope="col">Fecha y hora</th>
                <th scope="col">Paciente</th>
                <th scope="col">Terapeuta</th>
                <th scope="col">Sala</th>
                <th scope="col">Estatus</th>
                <th scope="col">
                  <span className="sr-only">Acciones</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {Array.from({ length: SKELETON_ROWS }, (_, row) => (
                <tr key={row} aria-hidden="true">
                  <td>
                    <span className="skeleton skeleton--narrow" />
                  </td>
                  <td>
                    <span className="skeleton" />
                  </td>
                  <td>
                    <span className="skeleton skeleton--wide" />
                  </td>
                  <td>
                    <span className="skeleton skeleton--wide" />
                  </td>
                  <td>
                    <span className="skeleton skeleton--narrow" />
                  </td>
                  <td>
                    <span className="skeleton skeleton--narrow" />
                  </td>
                  <td />
                </tr>
              ))}
            </tbody>
          </table>
        ) : datos.length === 0 ? (
          <div className="empty" role="status">
            <span className="empty__icon">
              {filtrosActivos ? (
                <Search size={44} aria-hidden="true" />
              ) : (
                <CalendarCheck size={44} aria-hidden="true" />
              )}
            </span>
            {filtrosActivos ? (
              <>
                <h2>No encontramos citas con estos filtros</h2>
                <p>Prueba quitando alguno de los filtros aplicados.</p>
                <button type="button" className="button button--secondary" onClick={limpiarFiltros}>
                  Quitar filtros
                </button>
              </>
            ) : (
              <>
                <h2>{ESTADO_VACIO[estado]}</h2>
                <p>Cuando haya citas con este estatus aparecerán aquí.</p>
              </>
            )}
          </div>
        ) : (
          <table className="data-table">
            <caption className="sr-only">Citas {estado.toLowerCase()}s</caption>
            <thead>
              <tr>
                <th scope="col">Folio</th>
                <th scope="col">Fecha y hora</th>
                <th scope="col">Paciente</th>
                <th scope="col">Terapeuta</th>
                <th scope="col">Sala</th>
                <th scope="col">Estatus</th>
                <th scope="col">
                  <span className="sr-only">Acciones</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {datos.map((cita) => {
                const fechaIso = enHoraClinica(cita.inicio).fecha;
                const sIdx = getSalaIdx(cita.sala.id);
                const salaColor = getSalaColor(sIdx >= 0 ? sIdx : 0);
                return (
                  <tr
                    key={cita.id}
                    tabIndex={0}
                    data-cita={cita.id}
                    className="data-table__row"
                    onClick={() => setCitaParaDetalle(cita)}
                    onKeyDown={(event) => onRowKeyDown(event, cita)}
                    aria-label={`Ver cita ${cita.folio}`}
                  >
                    <td className="mono">{cita.folio}</td>
                    <td>
                      <div className="when">
                        <b>{fMedia(fechaIso)}</b>
                        <span>{rangoLegible(cita.inicio, cita.fin)}</span>
                      </div>
                    </td>
                    <td>
                      <span className="person__name">{cita.paciente.nombre_completo}</span>
                    </td>
                    <td className="muted">
                      {cita.terapeuta.nombre_completo}
                      {cita.terapeuta.activo === false ? (
                        <> <span className="badge badge--off">Baja</span></>
                      ) : null}
                    </td>
                    <td>
                      <span className="room-name" style={{ fontWeight: 650 }}>
                        <span className="dot" style={{ backgroundColor: salaColor }} />
                        {cita.sala.nombre}
                      </span>
                    </td>
                    <td>
                      <EstadoBadge estado={cita.estado} />
                    </td>
                    <td onClick={(e) => e.stopPropagation()}>
                      <div className="row-actions">
                        {cita.estado === 'Pendiente' ? (
                          <button
                            type="button"
                            className="icon-act is-danger"
                            data-cancel={cita.id}
                            aria-label={`Cancelar ${cita.folio}`}
                            title="Cancelar cita"
                            onClick={() => setCitaParaCancelar(cita)}
                          >
                            <CircleX size={16} aria-hidden="true" />
                          </button>
                        ) : (
                          <span className="icon-act" aria-hidden="true" />
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}

        {total > 0 && !list.isError ? (
          <nav className="pagination" aria-label="Paginación de citas">
            <p>
              Mostrando {desde}–{hasta} de {total}
            </p>
            <div className="pagination__actions">
              <button
                type="button"
                className="button button--secondary"
                disabled={pagina <= 1}
                onClick={() => updateParams({ pagina: String(pagina - 1) })}
              >
                Anterior
              </button>
              <button
                type="button"
                className="button button--secondary"
                disabled={pagina >= ultimaPagina}
                onClick={() => updateParams({ pagina: String(pagina + 1) })}
              >
                Siguiente
              </button>
            </div>
          </nav>
        ) : null}
      </section>

      <Link to="/inicio/citas/nueva" className="button button--primary fab">
        <CalendarPlus size={18} aria-hidden="true" />
        Agendar cita
      </Link>

      <DetalleCitaDialog
        isOpen={Boolean(citaParaDetalle)}
        cita={citaParaDetalle}
        onClose={() => setCitaParaDetalle(null)}
        onCancelar={(c) => {
          setCitaParaDetalle(null);
          setCitaParaCancelar(c);
        }}
        salaColor={
          citaParaDetalle
            ? getSalaColor(getSalaIdx(citaParaDetalle.sala.id) >= 0 ? getSalaIdx(citaParaDetalle.sala.id) : 0)
            : undefined
        }
      />

      <CancelarPorFolioDialog
        isOpen={isFolioModalOpen}
        onClose={() => setIsFolioModalOpen(false)}
        onSelectCita={(cita) => {
          setIsFolioModalOpen(false);
          setCitaParaCancelar(cita);
        }}
        accessToken={session.token}
      />

      <CancelarCitaDialog
        isOpen={Boolean(citaParaCancelar)}
        cita={citaParaCancelar}
        onClose={() => setCitaParaCancelar(null)}
        onCanceled={(c) => {
          const fechaIso = enHoraClinica(c.inicio).fecha;
          const horario = rangoLegible(c.inicio, c.fin);
          setFlashMessage(
            `Cita ${c.folio} cancelada. El horario de ${c.sala.nombre} del ${fMedia(fechaIso).toLowerCase()}, ${horario}, quedó libre para nuevas citas.`,
          );
          void queryClient.invalidateQueries({ queryKey: citaKeys.todo });
        }}
        accessToken={session.token}
      />
    </div>
  );
}
