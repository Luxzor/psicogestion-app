import { useEffect, useId, useRef, useState } from 'react';
import { CircleAlert, DoorOpen, LoaderCircle, RotateCcw, RotateCw } from 'lucide-react';
import { newIdempotencyKey } from '../idempotency';
import { salasApi } from '../api';
import type { Sala } from '../types';
import { fMedia, getSalaColor } from '../validation';
import '../../pacientes/styles/pacientes.css';

export type RecuperarSalaDialogProps = {
  isOpen: boolean;
  onClose: () => void;
  onRestored?: (sala: Sala) => void;
  accessToken?: string;
  preselectedSala?: Sala | null;
};

function RecuperarSalaDialogModal({
  onClose,
  onRestored,
  accessToken = '',
  preselectedSala = null,
}: Omit<RecuperarSalaDialogProps, 'isOpen'>) {
  const [selectedSala, setSelectedSala] = useState<Sala | null>(preselectedSala);
  const [inactivas, setInactivas] = useState<Sala[]>([]);
  const [loading, setLoading] = useState(!preselectedSala);
  const [error, setError] = useState(false);
  const [saving, setSaving] = useState(false);
  const [netError, setNetError] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const idempotencyKeyRef = useRef(newIdempotencyKey());
  const dialogRef = useRef<HTMLElement>(null);

  const titleId = useId();
  const descId = useId();

  useEffect(() => {
    let ignore = false;
    if (!preselectedSala) {
      const fetchInactivas = async () => {
        try {
          const res = await salasApi.list({ estado: 'inactivas' }, accessToken);
          if (!ignore) {
            setInactivas(res.salas);
            if (res.salas.length > 0) {
              setSelectedSala((prev) => prev ?? res.salas[0]);
            }
          }
        } catch {
          if (!ignore) setError(true);
        } finally {
          if (!ignore) setLoading(false);
        }
      };
      void fetchInactivas();
    }
    return () => {
      ignore = true;
    };
  }, [preselectedSala, accessToken]);

  // Manejo de foco y Escape
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !saving) {
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
  }, [saving, onClose]);

  const handleRestore = async () => {
    if (!selectedSala) return;
    setSaving(true);
    setNetError(false);
    setNotice(null);

    try {
      const res = await salasApi.restore(selectedSala.id, accessToken, idempotencyKeyRef.current);
      setSaving(false);
      onRestored?.(res.sala);
      onClose();
    } catch (err: unknown) {
      setSaving(false);
      const apiErr = err as { codigo?: string; mensaje?: string };
      if (apiErr?.codigo === 'SALA_ACTIVA') {
        setNotice('Esta sala ya se encuentra activa.');
      } else {
        setNetError(true);
      }
    }
  };

  return (
    <div className="dialog-backdrop" role="presentation">
      <section
        ref={dialogRef}
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descId}
      >
        <h2 id={titleId}>Recuperar sala</h2>
        <p id={descId} className="dialog-description">
          Restaura una sala dada de baja para que vuelva a estar disponible en la agenda y citas.
        </p>

        {notice && (
          <div className="notice warning" role="alert">
            <CircleAlert size={16} aria-hidden="true" />
            <div className="notice__body">{notice}</div>
          </div>
        )}

        {netError && (
          <div className="notice warning" role="alert">
            <CircleAlert size={16} aria-hidden="true" />
            <div className="notice__body">
              No se pudo recuperar la sala. Revisa tu conexión e inténtalo de nuevo.
            </div>
            <div className="notice__actions">
              <button type="button" className="button button--secondary" onClick={handleRestore}>
                <RotateCw size={14} aria-hidden="true" />
                Reintentar
              </button>
            </div>
          </div>
        )}

        <div className="dialog-body">
          {loading ? (
            <p className="dialog-loading" aria-live="polite">
              <LoaderCircle size={16} className="spin" aria-hidden="true" />
              Cargando salas dadas de baja...
            </p>
          ) : error ? (
            <p className="field-error" role="alert">
              No se pudo obtener la lista de salas dadas de baja.
            </p>
          ) : inactivas.length === 0 && !preselectedSala ? (
            <div className="empty" style={{ padding: '1rem 0' }}>
              <span className="empty__icon" style={{ width: '2.5rem', height: '2.5rem' }}>
                <DoorOpen size={24} aria-hidden="true" />
              </span>
              <p style={{ margin: 0, fontWeight: 700 }}>No hay salas dadas de baja</p>
              <p className="muted" style={{ fontSize: '0.8rem', margin: '0.2rem 0 0' }}>
                Todas las salas registradas se encuentran activas actualmente.
              </p>
            </div>
          ) : (
            <div>
              <p style={{ fontSize: '0.82rem', fontWeight: 700, margin: '0 0 0.5rem', textAlign: 'left' }}>
                Elige la sala que deseas recuperar:
              </p>
              <div className="pick-list" role="radiogroup" aria-label="Salas dadas de baja">
                {(preselectedSala ? [preselectedSala] : inactivas).map((s, idx) => {
                  const isChecked = selectedSala?.id === s.id;
                  const color = getSalaColor(idx);
                  return (
                    <label key={s.id} className="pick">
                      <input
                        type="radio"
                        name="recuperar-sala"
                        value={s.id}
                        checked={isChecked}
                        onChange={() => setSelectedSala(s)}
                        disabled={saving}
                      />
                      <span className="dot" style={{ backgroundColor: color }} aria-hidden="true" />
                      <span>{s.nombre}</span>
                      <small>
                        · {s.fecha_baja ? `Dada de baja el ${fMedia(s.fecha_baja)}` : 'Inactiva'}
                      </small>
                    </label>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        <div className="dialog-actions">
          <button
            type="button"
            className="button button--secondary"
            onClick={onClose}
            disabled={saving}
          >
            Cancelar
          </button>
          <button
            type="button"
            className="button button--primary"
            onClick={handleRestore}
            disabled={saving || !selectedSala || (inactivas.length === 0 && !preselectedSala)}
          >
            {saving ? (
              <>
                <LoaderCircle size={16} className="spin" aria-hidden="true" />
                Recuperando...
              </>
            ) : (
              <>
                <RotateCcw size={16} aria-hidden="true" />
                Recuperar sala
              </>
            )}
          </button>
        </div>
      </section>
    </div>
  );
}

export function RecuperarSalaDialog({ isOpen, ...props }: RecuperarSalaDialogProps) {
  if (!isOpen) return null;
  return <RecuperarSalaDialogModal {...props} />;
}
