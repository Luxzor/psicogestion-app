import type { KeyboardEvent } from 'react';
import { useEffect, useState } from 'react';
import { RotateCw, Search, Stethoscope, UserCheck, UserPlus, UserX, X } from 'lucide-react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import type { Session } from '../../auth/types';
import { FormNotice } from '../../pacientes/components/FormNotice';
import { StatusFilter } from '../../pacientes/components/StatusFilter';
import { TherapistAvatar } from '../components/TherapistAvatar';
import { useTherapistList } from '../hooks/useTerapeutas';
import type { Flash, TherapistListItem, TherapistListState } from '../types';
import '../../pacientes/styles/pacientes.css';
import '../styles/terapeutas.css';

const PAGE_SIZE = 25;
const SEARCH_DELAY_MS = 300;
const SKELETON_ROWS = 5;
const FLASH_DURATION_MS = 7000;

const readState = (value: string | null): TherapistListState =>
  value === 'inactivos' ? 'inactivos' : 'activos';

/**
 * EDT 4.3.5. Lista de terapeutas (PG-DSN-002 §5.7). Ruta /inicio/terapeutas. El filtro
 * "Mostrar: Activos o Dados de baja" vive en la URL (`?estado=inactivos`), igual que en pacientes,
 * de modo que al volver desde un perfil la lista conserva el filtro elegido.
 */
export function TerapeutasPage({ session }: { session: Session }) {
  const location = useLocation();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const estado = readState(searchParams.get('estado'));
  const inactivos = estado === 'inactivos';
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [pagina, setPagina] = useState(1);
  const [flash, setFlash] = useState<Flash | null>(
    () => (location.state as { flash?: Flash } | null)?.flash ?? null,
  );

  useEffect(() => {
    if ((location.state as { flash?: Flash } | null)?.flash) {
      navigate(location.pathname, { replace: true, state: null });
    }
  }, [location.pathname, location.state, navigate]);

  useEffect(() => {
    if (!flash) return;
    const timer = setTimeout(() => setFlash(null), FLASH_DURATION_MS);
    return () => clearTimeout(timer);
  }, [flash]);

  // Búsqueda con pausa de 300 ms para no consultar en cada tecla (§5.7).
  useEffect(() => {
    const timer = setTimeout(() => {
      setQuery((current) => {
        const next = search.trim();
        if (next !== current) setPagina(1);
        return next;
      });
    }, SEARCH_DELAY_MS);
    return () => clearTimeout(timer);
  }, [search]);

  const list = useTherapistList(
    { pagina, tamano: PAGE_SIZE, q: query || undefined, estado },
    session.token,
  );
  const datos = list.data?.datos ?? [];
  const total = list.data?.total ?? 0;
  const desde = total === 0 ? 0 : (pagina - 1) * PAGE_SIZE + 1;
  const hasta = Math.min(pagina * PAGE_SIZE, total);
  const ultimaPagina = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const openProfile = (id: string) => navigate(`/inicio/terapeutas/${id}`);

  // Cambiar el filtro conserva la búsqueda y regresa a la primera página (§5.7).
  function changeState(next: TherapistListState) {
    setPagina(1);
    setSearchParams(
      (current) => {
        const params = new URLSearchParams(current);
        if (next === 'activos') params.delete('estado');
        else params.set('estado', next);
        return params;
      },
      { replace: true },
    );
  }

  const listCaption = inactivos ? 'Terapeutas dados de baja' : 'Terapeutas activos';

  function onRowKeyDown(event: KeyboardEvent<HTMLTableRowElement>, id: string) {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    openProfile(id);
  }

  return (
    <div className="page">
      <div className="page-head">
        <div className="page-title">
          <span className="page-title__icon">
            <Stethoscope size={22} aria-hidden="true" />
          </span>
          <div>
            <h1>Terapeutas</h1>
            <p>Consulta y actualiza a los terapeutas que colaboran en la clínica.</p>
          </div>
        </div>
        <div className="page-tools">
          <StatusFilter value={estado} onChange={changeState} label="Mostrar terapeutas" />
          <div className="search">
            <Search size={16} aria-hidden="true" />
            <input
              type="search"
              id="buscar-terapeuta"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Buscar por nombre, cédula, teléfono o correo"
              aria-label="Buscar por nombre, cédula, teléfono o correo"
              autoComplete="off"
            />
            {search ? (
              <button
                type="button"
                className="search__clear"
                onClick={() => setSearch('')}
                aria-label="Limpiar búsqueda"
              >
                <X size={14} aria-hidden="true" />
              </button>
            ) : null}
          </div>
        </div>
      </div>

      {flash ? (
        <FormNotice type={flash.type} onClose={() => setFlash(null)}>
          {flash.text}
        </FormNotice>
      ) : null}

      <section className="panel">
        <div aria-live="polite" className="sr-only">
          {list.isSuccess
            ? `${total} ${inactivos ? 'terapeutas dados de baja' : 'terapeutas activos'} encontrados.`
            : ''}
        </div>

        {list.isError ? (
          <div className="empty">
            <span className="empty__icon">
              <Stethoscope size={44} aria-hidden="true" />
            </span>
            <h2>No pudimos cargar la lista</h2>
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
            <caption className="sr-only">Cargando terapeutas</caption>
            <thead>
              <tr>
                <th scope="col" className="sr-only">
                  Foto
                </th>
                <th scope="col">Nombre</th>
                <th scope="col">Cédula profesional</th>
                <th scope="col">Teléfono</th>
                <th scope="col" className="is-secondary">
                  Correo
                </th>
              </tr>
            </thead>
            <tbody>
              {Array.from({ length: SKELETON_ROWS }, (_, row) => (
                <tr key={row} aria-hidden="true">
                  <td>
                    <span className="skeleton skeleton--avatar" />
                  </td>
                  <td>
                    <span className="skeleton skeleton--wide" />
                  </td>
                  <td>
                    <span className="skeleton" />
                  </td>
                  <td>
                    <span className="skeleton" />
                  </td>
                  <td className="is-secondary">
                    <span className="skeleton" />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : datos.length === 0 ? (
          <div className="empty">
            <span className="empty__icon">
              {inactivos && !query ? (
                <UserCheck size={44} aria-hidden="true" />
              ) : (
                <Stethoscope size={44} aria-hidden="true" />
              )}
            </span>
            {query ? (
              <>
                <h2>Sin resultados</h2>
                <p>
                  No encontramos terapeutas {inactivos ? 'dados de baja ' : ''}con “{query}”.
                  Revisa el nombre, la cédula, el teléfono o el correo.
                </p>
              </>
            ) : inactivos ? (
              <>
                <h2>No hay terapeutas dados de baja</h2>
                <p>Cuando des de baja a un terapeuta, podrás encontrarlo aquí para reactivarlo.</p>
              </>
            ) : (
              <>
                <h2>Aún no hay terapeutas</h2>
                <p>Usa “Añadir terapeuta” para registrar el primero.</p>
              </>
            )}
          </div>
        ) : (
          <table className="data-table">
            <caption className="sr-only">{listCaption}</caption>
            <thead>
              <tr>
                <th scope="col" className="sr-only">
                  Foto
                </th>
                <th scope="col">Nombre</th>
                <th scope="col">Cédula profesional</th>
                <th scope="col">Teléfono</th>
                <th scope="col" className="is-secondary">
                  Correo
                </th>
              </tr>
            </thead>
            <tbody>
              {datos.map((terapeuta: TherapistListItem) => (
                <tr
                  key={terapeuta.id}
                  tabIndex={0}
                  className="data-table__row"
                  onClick={() => openProfile(terapeuta.id)}
                  onKeyDown={(event) => onRowKeyDown(event, terapeuta.id)}
                  aria-label={`Abrir el perfil de ${terapeuta.nombre_completo}`}
                >
                  <td>
                    <TherapistAvatar
                      therapistId={terapeuta.id}
                      nombreCompleto={terapeuta.nombre_completo}
                      fotoActualizadaEn={terapeuta.foto_actualizada_en}
                      accessToken={session.token}
                      size="sm"
                    />
                  </td>
                  <td>
                    <span className="data-table__name">{terapeuta.nombre_completo}</span>
                    {!terapeuta.activo ? (
                      <span className="badge badge--off">
                        <UserX size={12} aria-hidden="true" />
                        Dado de baja
                      </span>
                    ) : null}
                  </td>
                  <td className="is-mono">{terapeuta.cedula_profesional}</td>
                  <td>{terapeuta.telefono}</td>
                  <td className="is-secondary">{terapeuta.correo_electronico}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {total > 0 && !list.isError ? (
          <nav className="pagination" aria-label="Paginación de terapeutas">
            <p>
              Mostrando {desde}–{hasta} de {total}
            </p>
            <div className="pagination__actions">
              <button
                type="button"
                className="button button--secondary"
                disabled={pagina <= 1}
                onClick={() => setPagina((current) => Math.max(1, current - 1))}
              >
                Anterior
              </button>
              <button
                type="button"
                className="button button--secondary"
                disabled={pagina >= ultimaPagina}
                onClick={() => setPagina((current) => current + 1)}
              >
                Siguiente
              </button>
            </div>
          </nav>
        ) : null}
      </section>

      <Link to="/inicio/terapeutas/nuevo" className="button button--primary fab">
        <UserPlus size={18} aria-hidden="true" />
        Añadir terapeuta
      </Link>
    </div>
  );
}
