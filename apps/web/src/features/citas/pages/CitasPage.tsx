import { useCallback, useEffect, useState, type KeyboardEvent } from 'react';
import {
  CalendarCheck,
  CalendarPlus,
  CalendarX,
  CircleX,
  Clock,
  RotateCw,
  Search,
  WifiOff,
  X,
} from 'lucide-react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import type { Session } from '../../auth/types';
import { useTherapistList } from '../../terapeutas/hooks/useTerapeutas';
import { fMedia } from '../../salas/validation';
import { useCitaList, useSalasActivas } from '../hooks/useCitas';
import { enHoraClinica, hoyEnClinica, rangoDelPeriodo, rangoLegible } from '../horario';
import type { CitaEstado, CitaListParams } from '../types';
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
 * RF 5.2.1–5.2.3 (EDT 5.3.3). Lista de citas (PG-DSN-003 5.5; maqueta PG-DSN-003-INT). Ruta
 * /inicio/citas. Los filtros viven en la URL: cambiar cualquiera vuelve a la página 1.
 */
export function CitasPage({ session }: { session: Session }) {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const estado = readEstado(searchParams.get('estado'));
  const idSala = searchParams.get('sala') ?? '';
  const idTerapeuta = searchParams.get('terapeuta') ?? '';
  const periodo = readPeriodo(searchParams.get('periodo'));
  const fecha = searchParams.get('fecha') || hoyEnClinica();
  const folio = searchParams.get('folio') ?? '';
  const pagina = Math.max(1, Number(searchParams.get('pagina')) || 1);

  const [folioInput, setFolioInput] = useState(folio);

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

  // Búsqueda por folio con pausa de 300 ms (mismo patrón que pacientes, §5.4). El folio es de
  // coincidencia exacta: solo se manda al filtro cuando el texto ya tiene el formato correcto.
  useEffect(() => {
    const timer = setTimeout(() => {
      const valido = folioInput.trim() !== '' && !validateFolio(folioInput);
      updateParams({ folio: valido ? normalizeFolio(folioInput) : null }, { resetPagina: true });
    }, SEARCH_DELAY_MS);
    return () => clearTimeout(timer);
  }, [folioInput, updateParams]);

  const folioErrorVisible = folioInput.trim() !== '' && Boolean(validateFolio(folioInput));

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

  const openDetalle = (id: string) => navigate(`/inicio/citas/${id}`);
  function onRowKeyDown(event: KeyboardEvent<HTMLTableRowElement>, id: string) {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    openDetalle(id);
  }

  function limpiarFiltros() {
    setFolioInput('');
    updateParams(
      { sala: null, terapeuta: null, periodo: null, fecha: null, folio: null },
      { resetPagina: true },
    );
  }

  return (
    <div className="page">
      <div className="page-head">
        <div className="page-title">
          <span className="page-title__icon">
            <CalendarCheck size={22} aria-hidden="true" />
          </span>
          <div>
            <h1>Citas</h1>
            <p>Consulta, filtra y agenda las citas de la clínica.</p>
          </div>
        </div>
      </div>

      <div className="tabs" role="tablist" aria-label="Estatus de la cita">
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
          </button>
        ))}
      </div>

      <div className="panel citas-filtros">
        <div className="citas-filtros__periodo segmented" role="group" aria-label="Periodo">
          {PERIODOS.map((item) => (
            <button
              key={item.value}
              type="button"
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

        {periodo !== 'todo' ? (
          <input
            type="date"
            aria-label="Fecha de referencia del periodo"
            value={fecha}
            onChange={(event) =>
              updateParams({ fecha: event.target.value || null }, { resetPagina: true })
            }
          />
        ) : null}

        <select
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
            </option>
          ))}
        </select>

        <select
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
            </option>
          ))}
        </select>

        <div className="search" role="search">
          <Search size={16} aria-hidden="true" />
          <input
            type="search"
            id="buscar-folio"
            value={folioInput}
            onChange={(event) => setFolioInput(event.target.value)}
            placeholder="Buscar por folio"
            aria-label="Buscar por folio"
            aria-describedby="buscar-folio-hint"
            autoComplete="off"
          />
          {folioInput ? (
            <button
              type="button"
              className="search__clear"
              onClick={() => setFolioInput('')}
              aria-label="Limpiar búsqueda"
            >
              <X size={14} aria-hidden="true" />
            </button>
          ) : null}
        </div>
      </div>
      <span
        className="field-hint citas-filtros__folio-hint"
        id="buscar-folio-hint"
        hidden={!folioErrorVisible}
      >
        {validateFolio(folioInput)}
      </span>

      <section className="panel" id="citas-panel" role="tabpanel" aria-labelledby={`tab-${estado}`}>
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
                </tr>
              ))}
            </tbody>
          </table>
        ) : datos.length === 0 ? (
          <div className="empty">
            <span className="empty__icon">
              <CalendarCheck size={44} aria-hidden="true" />
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
              </tr>
            </thead>
            <tbody>
              {datos.map((cita) => (
                <tr
                  key={cita.id}
                  tabIndex={0}
                  className="data-table__row"
                  onClick={() => openDetalle(cita.id)}
                  onKeyDown={(event) => onRowKeyDown(event, cita.id)}
                  aria-label={`Abrir la cita ${cita.folio}`}
                >
                  <td className="mono">{cita.folio}</td>
                  <td>
                    {fMedia(enHoraClinica(cita.inicio).fecha)} ·{' '}
                    {rangoLegible(cita.inicio, cita.fin)}
                  </td>
                  <td>{cita.paciente.nombre_completo}</td>
                  <td>{cita.terapeuta.nombre_completo}</td>
                  <td>{cita.sala.nombre}</td>
                  <td>
                    <EstadoBadge estado={cita.estado} />
                  </td>
                </tr>
              ))}
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
    </div>
  );
}
