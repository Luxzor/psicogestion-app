import { useEffect, useId, useRef, useState } from 'react';
import { CircleAlert, LoaderCircle, RotateCw, Trash2 } from 'lucide-react';
import { newIdempotencyKey } from '../idempotency';
import { salasApi } from '../api';
import type { Sala } from '../types';
import { getSalaColor } from '../validation';
import '../../pacientes/styles/pacientes.css';

export type EliminarSalaDialogProps = {
  isOpen: boolean;
  onClose: () => void;
  onDischarged?: (sala: Sala) => void;
  accessToken?: string;
  preselectedSala?: Sala | null;
  activeSalas?: Sala[];
};

type SalaItemWithPending = {
  sala: Sala;
  pendingCount: number;
};

function EliminarSalaDialogModal({
  onClose,
  onDischarged,
  accessToken = '',
  preselectedSala = null,
  activeSalas,
}: Omit<EliminarSalaDialogProps, 'isOpen'>) {
  const [step, setStep] = useState<'select' | 'confirm'>(preselectedSala ? 'confirm' : 'select');
  const [selectedSala, setSelectedSala] = useState<Sala | null>(preselectedSala);
  const [salasWithPending, setSalasWithPending] = useState<SalaItemWithPending[]>([]);
  const [loadingList, setLoadingList] = useState(!preselectedSala);
  const [listError, setListError] = useState(false);

  const [fetchedPendingCount, setFetchedPendingCount] = useState<number | null>(null);
  const [loadingPending, setLoadingPending] = useState(Boolean(preselectedSala));

  const [isDeleting, setIsDeleting] = useState(false);
  const [netError, setNetError] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const idempotencyKeyRef = useRef(newIdempotencyKey());
  const dialogRef = useRef<HTMLElement>(null);

  const titleId = useId();
  const descId = useId();

  // Carga de salas activas y conteo de citas pendientes para el paso 1 (selección)
  useEffect(() => {
    let ignore = false;
    if (!preselectedSala) {
      const fetchList = async () => {
        try {
          let salas = activeSalas;
          if (!salas) {
            const response = await salasApi.list({ estado: 'activas' }, accessToken);
            salas = response.salas;
          }
          const withCounts = await Promise.all(
            salas.map(async (sala) => {
              try {
                const countRes = await salasApi.countPendingAppointments(sala.id, accessToken);
                return { sala, pendingCount: countRes.total };
              } catch {
                return { sala, pendingCount: 0 };
              }
            }),
          );
          if (!ignore) {
            setSalasWithPending(withCounts);
          }
        } catch {
          if (!ignore) {
            setListError(true);
          }
        } finally {
          if (!ignore) {
            setLoadingList(false);
          }
        }
      };

      void fetchList();
    }
    return () => {
      ignore = true;
    };
  }, [preselectedSala, activeSalas, accessToken]);

  // Si se entra directo a confirmación con una sala preseleccionada, se consulta su conteo
  useEffect(() => {
    let ignore = false;
    if (step === 'confirm' && preselectedSala) {
      salasApi
        .countPendingAppointments(preselectedSala.id, accessToken)
        .then((res) => {
          if (!ignore) {
            setFetchedPendingCount(res.total);
            setLoadingPending(false);
          }
        })
        .catch(() => {
          if (!ignore) {
            setFetchedPendingCount(0);
            setLoadingPending(false);
          }
        });
    }
    return () => {
      ignore = true;
    };
  }, [step, preselectedSala, accessToken]);

  // Manejo de foco y tecla Escape
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !isDeleting) {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key === 'Tab') {
        const dialog = dialogRef.current;
        if (!dialog) return;
        const focusables = dialog.querySelectorAll<HTMLElement>(
          'button:not([disabled]), input:not([disabled])',
        );
        if (!focusables.length) return;
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isDeleting, onClose]);

  const handleSelectRadio = (sala: Sala) => {
    setSelectedSala(sala);
  };

  const handleContinueToConfirm = () => {
    if (selectedSala) {
      setStep('confirm');
    }
  };

  const handleConfirmDischarge = async () => {
    if (!selectedSala || isDeleting) return;

    setIsDeleting(true);
    setNetError(false);
    setNotice(null);

    try {
      const response = await salasApi.discharge(
        selectedSala.id,
        accessToken,
        idempotencyKeyRef.current,
      );
      onClose();
      onDischarged?.(response.sala);
    } catch (err: unknown) {
      setIsDeleting(false);
      const isNetwork =
        (err instanceof TypeError && err.message.toLowerCase().includes('fetch')) ||
        (err instanceof Error && err.name === 'AbortError');

      if (isNetwork) {
        setNetError(true);
        setNotice(
          'No pudimos eliminar la sala por un error de conexión. La sala no cambió; intenta de nuevo.',
        );
      } else if (err instanceof Error) {
        setNotice(err.message);
      } else {
        setNotice('Ocurrió un error inesperado al dar de baja la sala.');
      }
    }
  };

  const pendingCount =
    fetchedPendingCount ??
    (selectedSala
      ? (salasWithPending.find((item) => item.sala.id === selectedSala.id)?.pendingCount ?? 0)
      : 0);

  if (step === 'select') {
    return (
      <div className="dialog-backdrop" onClick={(e) => e.target === e.currentTarget && onClose()}>
        <section
          ref={dialogRef}
          className="dialog"
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          aria-describedby={descId}
        >
          <div className="dialog-head">
            <h2 id={titleId}>Eliminar sala</h2>
          </div>

          <div className="dialog-body">
            <p id={descId}>Selecciona la sala que quieres eliminar.</p>

            {loadingList ? (
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.6rem',
                  padding: '1.5rem 0',
                  color: 'var(--color-muted)',
                }}
              >
                <LoaderCircle size={18} className="spin" aria-hidden="true" />
                <span>Cargando salas registradas...</span>
              </div>
            ) : listError ? (
              <div
                className="notice error notice--block"
                role="alert"
                style={{ marginTop: '0.8rem' }}
              >
                <CircleAlert size={17} aria-hidden="true" />
                <div className="notice__body">
                  No pudimos cargar las salas registradas.
                  <div style={{ marginTop: '0.5rem' }}>
                    <button
                      type="button"
                      className="button button--secondary"
                      onClick={() => {
                        setLoadingList(true);
                        setListError(false);
                        salasApi
                          .list({ estado: 'activas' }, accessToken)
                          .then(async (response) => {
                            const withCounts = await Promise.all(
                              response.salas.map(async (sala) => {
                                try {
                                  const countRes = await salasApi.countPendingAppointments(
                                    sala.id,
                                    accessToken,
                                  );
                                  return { sala, pendingCount: countRes.total };
                                } catch {
                                  return { sala, pendingCount: 0 };
                                }
                              }),
                            );
                            setSalasWithPending(withCounts);
                          })
                          .catch(() => setListError(true))
                          .finally(() => setLoadingList(false));
                      }}
                    >
                      <RotateCw size={14} aria-hidden="true" /> Reintentar
                    </button>
                  </div>
                </div>
              </div>
            ) : salasWithPending.length === 0 ? (
              <p style={{ color: 'var(--color-muted)', marginTop: '0.8rem' }}>
                No hay salas activas disponibles para eliminar.
              </p>
            ) : (
              <div className="pick-list" role="radiogroup" aria-label="Salas registradas">
                {salasWithPending.map((item, index) => {
                  const isChecked = selectedSala?.id === item.sala.id;
                  return (
                    <label key={item.sala.id} className="pick">
                      <input
                        type="radio"
                        name="del-sala"
                        value={item.sala.id}
                        checked={isChecked}
                        onChange={() => handleSelectRadio(item.sala)}
                      />
                      <span
                        className="dot"
                        style={{ backgroundColor: getSalaColor(index) }}
                        aria-hidden="true"
                      />
                      <span>{item.sala.nombre}</span>
                      <small>
                        {item.pendingCount > 0
                          ? `${item.pendingCount} ${
                              item.pendingCount === 1 ? 'cita pendiente' : 'citas pendientes'
                            }`
                          : 'Sin citas pendientes'}
                      </small>
                    </label>
                  );
                })}
              </div>
            )}
          </div>

          <div className="dialog-actions">
            <button
              type="button"
              className="button button--secondary"
              id="del-cancel"
              onClick={onClose}
            >
              Cancelar
            </button>
            <button
              type="button"
              className="button button--danger"
              id="del-next"
              disabled={!selectedSala}
              onClick={handleContinueToConfirm}
            >
              Continuar
            </button>
          </div>
        </section>
      </div>
    );
  }

  // Paso 2: Confirmación (alertdialog)
  const isBlocked = (pendingCount ?? 0) > 0;

  return (
    <div
      className="dialog-backdrop"
      onClick={(e) => e.target === e.currentTarget && !isDeleting && onClose()}
    >
      <section
        ref={dialogRef}
        className="dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descId}
      >
        <div className="dialog-head">
          <h2 id={titleId}>¿Eliminar la sala “{selectedSala?.nombre}”?</h2>
        </div>

        <div className="dialog-body">
          {loadingPending ? (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.6rem',
                padding: '1rem 0',
                color: 'var(--color-muted)',
              }}
            >
              <LoaderCircle size={18} className="spin" aria-hidden="true" />
              <span>Verificando citas de la sala...</span>
            </div>
          ) : isBlocked ? (
            <>
              <p id={descId}>No es posible eliminarla todavía.</p>
              <div
                className="notice error notice--block"
                role="alert"
                style={{ marginTop: '0.8rem' }}
              >
                <CircleAlert size={17} aria-hidden="true" />
                <div className="notice__body">
                  La sala tiene {pendingCount}{' '}
                  {pendingCount === 1 ? 'cita pendiente' : 'citas pendientes'}. Modifícalas o cancélalas
                  antes de eliminar la sala.
                </div>
              </div>
            </>
          ) : (
            <>
              <p id={descId}>
                La sala dejará de aparecer en la lista, y ya no podrá asignarse a citas nuevas. Las
                citas pasadas se conservan en el histórico.
              </p>
              {notice && (
                <div
                  className="notice error notice--block"
                  role="alert"
                  style={{ marginTop: '0.8rem' }}
                >
                  <CircleAlert size={17} aria-hidden="true" />
                  <div className="notice__body">{notice}</div>
                </div>
              )}
            </>
          )}
        </div>

        <div className="dialog-actions">
          <button
            type="button"
            className="button button--secondary"
            id="del-cancel"
            onClick={onClose}
            disabled={isDeleting}
          >
            Cancelar
          </button>
          <button
            type="button"
            className="button button--danger"
            id="del-ok"
            onClick={handleConfirmDischarge}
            disabled={isBlocked || loadingPending || isDeleting}
          >
            {isDeleting ? (
              <>
                <LoaderCircle size={16} className="spin" aria-hidden="true" />
                Eliminando...
              </>
            ) : netError ? (
              <>
                <RotateCw size={15} aria-hidden="true" />
                Reintentar
              </>
            ) : (
              <>
                <Trash2 size={15} aria-hidden="true" />
                Eliminar sala
              </>
            )}
          </button>
        </div>
      </section>
    </div>
  );
}

/**
 * EDT 5.3.1. Diálogo de eliminación de salas con baja lógica (RF 4.2.1 a RF 4.2.5; ADR-19, CA-4.2-01, CA-4.2-02).
 * Incluye selección previa si no se especificó sala, y rechaza la eliminación si tiene citas pendientes futuras.
 */
export function EliminarSalaDialog(props: EliminarSalaDialogProps) {
  if (!props.isOpen) return null;
  return <EliminarSalaDialogModal {...props} />;
}
