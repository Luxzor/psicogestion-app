import type { KeyboardEvent } from 'react';
import { useEffect, useState } from 'react';
import { RotateCw, Search, UserCheck, UserPlus, Users, UserX } from 'lucide-react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import type { Session } from '../../auth/types';
import { FormNotice } from '../components/FormNotice';
import { StatusFilter } from '../components/StatusFilter';
import { useFlash } from '../hooks/useFlash';
import { usePatientList } from '../hooks/usePacientes';
import type { PatientListItem, PatientListState } from '../types';
import '../styles/pacientes.css';

const PAGE_SIZE = 25;
const SEARCH_DELAY_MS = 300;
const SKELETON_ROWS = 5;

const readState = (value: string | null): PatientListState =>
  value === 'inactivos' ? 'inactivos' : 'activos';

/**
 * EDT 4.3.2 y 4.3.3. Lista de pacientes (PG-DSN-002 §5.4). Ruta /inicio/pacientes.
 * El filtro "Mostrar: Activos o Dados de baja" vive en la URL (`?estado=inactivos`), de modo que
 * al volver desde un perfil la lista conserva el filtro elegido.
 */
export function PacientesPage({ session }: { session: Session }) {
  const navigate = useNavigate();
  const { flash, dismiss } = useFlash();
  const [searchParams, setSearchParams] = useSearchParams();
  const estado = readState(searchParams.get('estado'));
  const inactivos = estado === 'inactivos';
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [pagina, setPagina] = useState(1);

  // Búsqueda con pausa de 300 ms para no consultar en cada tecla (§5.4).
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

  const list = usePatientList(
    { pagina, tamano: PAGE_SIZE, q: query || undefined, estado },
    session.token,
  );
  const datos = list.data?.datos ?? [];
  const total = list.data?.total ?? 0;
  const desde = total === 0 ? 0 : (pagina - 1) * PAGE_SIZE + 1;
  const hasta = Math.min(pagina * PAGE_SIZE, total);
  const ultimaPagina = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const openProfile = (id: string) => navigate(`/inicio/pacientes/${id}`);

  // Cambiar el filtro conserva la búsqueda y regresa a la primera página (§5.4).
  function changeState(next: PatientListState) {
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

  const listCaption = inactivos ? 'Pacientes dados de baja' : 'Pacientes activos';

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
            <Users size={22} aria-hidden="true" />
          </span>
          <div>
            <h1>Pacientes</h1>
            <p>Consulta y actualiza los pacientes que atiende la clínica.</p>
          </div>
        </div>
        <div className="page-tools">
          <StatusFilter value={estado} onChange={changeState} label="Mostrar pacientes" />
          <div className="search">
            <Search size={16} aria-hidden="true" />
            <input
              type="search"
              id="buscar-paciente"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Buscar por nombre, CURP o teléfono"
              aria-label="Buscar por nombre, CURP o teléfono"
            />
          </div>
        </div>
      </div>

      {flash ? (
        <FormNotice type={flash.type} onClose={dismiss}>
          {flash.text}
        </FormNotice>
      ) : null}

      <section className="panel">
        <div aria-live="polite" className="sr-only">
          {list.isSuccess
            ? `${total} ${inactivos ? 'pacientes dados de baja' : 'pacientes activos'} encontrados.`
            : ''}
        </div>

        {list.isError ? (
          <div className="empty">
            <span className="empty__icon">
              <Users size={44} aria-hidden="true" />
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
            <caption className="sr-only">Cargando pacientes</caption>
            <thead>
              <tr>
                <th scope="col">Nombre</th>
                <th scope="col">Teléfono</th>
                <th scope="col" className="is-secondary">
                  Edad
                </th>
              </tr>
            </thead>
            <tbody>
              {Array.from({ length: SKELETON_ROWS }, (_, row) => (
                <tr key={row} aria-hidden="true">
                  <td>
                    <span className="skeleton skeleton--wide" />
                  </td>
                  <td>
                    <span className="skeleton" />
                  </td>
                  <td className="is-secondary">
                    <span className="skeleton skeleton--narrow" />
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
                <Users size={44} aria-hidden="true" />
              )}
            </span>
            {query ? (
              <>
                <h2>Sin resultados</h2>
                <p>
                  No encontramos pacientes {inactivos ? 'dados de baja ' : ''}con “{query}”. Revisa
                  el nombre o prueba con el teléfono.
                </p>
              </>
            ) : inactivos ? (
              <>
                <h2>No hay pacientes dados de baja</h2>
                <p>Cuando des de baja a un paciente, podrás encontrarlo aquí para reactivarlo.</p>
              </>
            ) : (
              <>
                <h2>Aún no hay pacientes</h2>
                <p>Usa “Añadir paciente” para registrar el primero.</p>
              </>
            )}
          </div>
        ) : (
          <table className="data-table">
            <caption className="sr-only">{listCaption}</caption>
            <thead>
              <tr>
                <th scope="col">Nombre</th>
                <th scope="col">Teléfono</th>
                <th scope="col" className="is-secondary">
                  Edad
                </th>
              </tr>
            </thead>
            <tbody>
              {datos.map((paciente: PatientListItem) => (
                <tr
                  key={paciente.id}
                  tabIndex={0}
                  className="data-table__row"
                  onClick={() => openProfile(paciente.id)}
                  onKeyDown={(event) => onRowKeyDown(event, paciente.id)}
                  aria-label={`Abrir el perfil de ${paciente.nombre_completo}`}
                >
                  <td>
                    <span className="data-table__name">{paciente.nombre_completo}</span>
                    {!paciente.activo ? (
                      <span className="badge badge--off">
                        <UserX size={12} aria-hidden="true" />
                        Dado de baja
                      </span>
                    ) : null}
                  </td>
                  <td>{paciente.telefono}</td>
                  <td className="is-secondary">{paciente.edad} años</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {total > 0 && !list.isError ? (
          <nav className="pagination" aria-label="Paginación de pacientes">
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

      <Link to="/inicio/pacientes/nuevo" className="button button--primary fab">
        <UserPlus size={18} aria-hidden="true" />
        Añadir paciente
      </Link>
    </div>
  );
}
