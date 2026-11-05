import { useEffect } from 'react';
import { DoorOpen, Info, LoaderCircle, RotateCw, WifiOff } from 'lucide-react';
import { getSalaColor } from '../../salas/validation';
import type { DisponibilidadSala } from '../../salas/types';
import { useDisponibilidad } from '../hooks/useCitas';
import {
  DURACIONES,
  enHoraClinica,
  etiquetaDuracion,
  minutosAHora,
  duracionABloques,
  yaPaso,
} from '../horario';

type EstadoVentana = 'libre' | 'reservada' | 'no_disponible' | 'pasado' | 'no_cabe';

const ETIQUETAS: Record<EstadoVentana, string> = {
  libre: 'Libre',
  reservada: 'Ocupada',
  no_disponible: 'No disponible',
  pasado: 'Pasado',
  no_cabe: 'No cabe',
};

/**
 * Estado de una ventana de `necesarios` bloques consecutivos a partir del índice `i`, a partir
 * de los bloques ya calculados por GET /salas/disponibilidad (estado por bloque de 30 min). No
 * recalcula empalmes: solo compone los estados que ya trae la respuesta para decidir si una
 * sesión de 1 a 4 bloques cabe completa a partir de ese inicio (la API no distingue si
 * "no_disponible" es por el terapeuta o por el paciente; aquí tampoco).
 */
function estadoVentana(
  sala: DisponibilidadSala,
  indiceInicio: number,
  necesarios: number,
  fecha: string,
  ahora: Date,
): EstadoVentana {
  if (indiceInicio + necesarios > sala.bloques.length) return 'no_cabe';
  for (let k = 0; k < necesarios; k += 1) {
    const bloque = sala.bloques[indiceInicio + k];
    const minutos = enHoraClinica(bloque.inicio).minutos;
    if (yaPaso(fecha, minutos, ahora)) return 'pasado';
    if (bloque.estado !== 'libre') return bloque.estado;
  }
  return 'libre';
}

function contarLibres(sala: DisponibilidadSala, necesarios: number, fecha: string, ahora: Date) {
  let total = 0;
  for (let i = 0; i < sala.bloques.length; i += 1) {
    if (estadoVentana(sala, i, necesarios, fecha, ahora) === 'libre') total += 1;
  }
  return total;
}

export type SalaHorarioValue = { salaId: string; salaNombre?: string; inicio: number | null };

type SalaHorarioGridProps = {
  fecha: string;
  fechaValida: boolean;
  duracion: number;
  onDuracionChange: (minutos: number) => void;
  idPaciente?: string;
  idTerapeuta?: string;
  value: SalaHorarioValue;
  onChange: (value: SalaHorarioValue) => void;
  error?: string;
  accessToken: string;
  ahora?: Date;
};

/**
 * RF 5.1.3–5.1.4, RNF 5.1.1 (EDT 5.3.3). Rejilla de sala y horario de "Agendar cita"
 * (PG-DSN-003 5.4 y maqueta PG-DSN-003-INT), alimentada por GET /salas/disponibilidad
 * (apps/web/src/features/salas/api.ts, sin tocarlo ni repetir su cálculo).
 */
export function SalaHorarioGrid({
  fecha,
  fechaValida,
  duracion,
  onDuracionChange,
  idPaciente,
  idTerapeuta,
  value,
  onChange,
  error,
  accessToken,
  ahora = new Date(),
}: SalaHorarioGridProps) {
  const necesarios = duracionABloques(duracion);
  const disponibilidad = useDisponibilidad(
    { fecha, id_paciente: idPaciente, id_terapeuta: idTerapeuta, duracion: necesarios },
    accessToken,
    fechaValida,
  );

  const salas = disponibilidad.data?.salas ?? [];
  const salaElegida = salas.find((s) => s.id === value.salaId) ?? null;

  // Si la sesión ya no cabe en el horario elegido (cambió la duración, la fecha o la sala deja
  // de estar libre), se limpia solo el inicio: el resto de la selección se conserva.
  useEffect(() => {
    if (value.inicio == null || !salaElegida) return;
    const indice = salaElegida.bloques.findIndex(
      (bloque) => enHoraClinica(bloque.inicio).minutos === value.inicio,
    );
    if (indice < 0 || estadoVentana(salaElegida, indice, necesarios, fecha, ahora) !== 'libre') {
      onChange({ ...value, inicio: null });
    }
    // Solo reacciona a cambios que afectan si el horario elegido sigue siendo válido.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [salaElegida, necesarios, fecha]);

  function elegirSala(sala: DisponibilidadSala) {
    onChange({
      salaId: sala.id,
      salaNombre: sala.nombre,
      inicio: value.salaId === sala.id ? value.inicio : null,
    });
  }

  function elegirInicio(inicio: number) {
    onChange({ salaId: value.salaId, salaNombre: value.salaNombre, inicio });
  }

  return (
    <div className="form-section">
      <h2>Sala, fecha y horario</h2>

      <div className="form-grid" style={{ marginBottom: '0.5rem' }}>
        <div className="field">
          <span className="field__label">
            <span>Duración</span>
          </span>
          <div className="segmented" role="group" aria-label="Duración">
            {DURACIONES.map((minutos) => (
              <button
                key={minutos}
                type="button"
                aria-pressed={duracion === minutos}
                onClick={() => onDuracionChange(minutos)}
              >
                {etiquetaDuracion(minutos)}
              </button>
            ))}
          </div>
        </div>
      </div>

      {!fechaValida ? (
        <p className="opt-note">Elige una fecha válida para ver los horarios.</p>
      ) : disponibilidad.isPending ? (
        <div className="times-skel" aria-label="Cargando disponibilidad">
          <LoaderCircle size={20} className="spin" aria-hidden="true" />
          <span>Consultando disponibilidad...</span>
        </div>
      ) : disponibilidad.isError ? (
        <div className="empty" role="alert">
          <span className="empty__icon">
            <WifiOff size={32} aria-hidden="true" />
          </span>
          <p>No pudimos consultar la disponibilidad.</p>
          <button
            type="button"
            className="button button--secondary"
            onClick={() => disponibilidad.refetch()}
          >
            <RotateCw size={15} aria-hidden="true" />
            Reintentar
          </button>
        </div>
      ) : (
        <>
          <div className="chips" role="group" aria-label="Salas">
            {salas.map((sala, index) => {
              const libres = contarLibres(sala, necesarios, fecha, ahora);
              const elegida = value.salaId === sala.id;
              return (
                <button
                  key={sala.id}
                  type="button"
                  className="chip"
                  aria-pressed={elegida}
                  disabled={libres === 0 && !elegida}
                  onClick={() => elegirSala(sala)}
                >
                  <span
                    className="dot"
                    style={{ backgroundColor: getSalaColor(index) }}
                    aria-hidden="true"
                  />
                  {sala.nombre}
                  <small>{libres ? `${libres} libres` : 'Sin horarios'}</small>
                </button>
              );
            })}
            {salas.length === 0 ? (
              <p className="opt-note">
                <DoorOpen size={15} aria-hidden="true" /> No hay salas activas registradas.
              </p>
            ) : null}
          </div>

          {!salaElegida ? (
            <p className="opt-note">
              <Info size={15} aria-hidden="true" /> Elige una sala para ver sus horarios libres.
            </p>
          ) : (
            <div className="times" role="listbox" aria-label="Horarios de inicio">
              {salaElegida.bloques.map((bloque, index) => {
                const inicioMinutos = enHoraClinica(bloque.inicio).minutos;
                const estado = estadoVentana(salaElegida, index, necesarios, fecha, ahora);
                const seleccionado = value.inicio === inicioMinutos;
                const disponible = estado === 'libre';
                return (
                  <button
                    key={bloque.inicio}
                    type="button"
                    className={`time${seleccionado ? ' is-sel' : ''}`}
                    role="option"
                    aria-selected={seleccionado}
                    disabled={!disponible && !seleccionado}
                    title={`${minutosAHora(inicioMinutos)} a ${minutosAHora(inicioMinutos + duracion)}: ${ETIQUETAS[estado]}`}
                    onClick={() => elegirInicio(inicioMinutos)}
                  >
                    {minutosAHora(inicioMinutos)}
                    <small>
                      {seleccionado
                        ? `a ${minutosAHora(inicioMinutos + duracion)}`
                        : ETIQUETAS[estado]}
                    </small>
                  </button>
                );
              })}
            </div>
          )}
        </>
      )}

      <span
        className="field-error"
        id="inicio-error"
        role="alert"
        style={{ display: 'block', marginTop: '0.5rem' }}
      >
        {error}
      </span>
    </div>
  );
}
