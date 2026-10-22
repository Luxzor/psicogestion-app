import { useState } from 'react';
import { CircleCheck, DoorOpen, Plus, Trash2, X } from 'lucide-react';
import type { Session } from '../../auth/types';
import { AgregarSalaDialog } from '../components/AgregarSalaDialog';
import { EliminarSalaDialog } from '../components/EliminarSalaDialog';
import type { Sala } from '../types';
import '../../pacientes/styles/pacientes.css';

export function SalasPage({ session }: { session?: Session }) {
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [isEliminarOpen, setIsEliminarOpen] = useState(false);
  const [flashMessage, setFlashMessage] = useState<string | null>(null);

  const handleCreated = (sala: Sala) => {
    setFlashMessage(`Sala “${sala.nombre}” agregada. Ya está disponible para agendar citas.`);
  };

  const handleDischarged = (sala: Sala) => {
    setFlashMessage(`Sala “${sala.nombre}” eliminada.`);
  };

  return (
    <div className="page">
      <div className="page-head">
        <div className="page-title">
          <span className="page-title__icon">
            <DoorOpen size={22} aria-hidden="true" />
          </span>
          <div>
            <h1>Salas</h1>
            <p>Administración de salas de la clínica.</p>
          </div>
        </div>
        <div className="page-tools">
          <button
            type="button"
            className="button button--danger-soft"
            id="btn-del"
            onClick={() => setIsEliminarOpen(true)}
          >
            <Trash2 size={16} aria-hidden="true" />
            Eliminar sala
          </button>
          <button
            type="button"
            className="button button--primary"
            id="btn-agregar-sala"
            onClick={() => setIsDialogOpen(true)}
          >
            <Plus size={16} aria-hidden="true" />
            Agregar sala
          </button>
        </div>
      </div>

      {flashMessage && (
        <div className="notice success notice--block" role="status" aria-live="polite">
          <CircleCheck size={17} aria-hidden="true" />
          <div className="notice__body">{flashMessage}</div>
          <button
            type="button"
            className="notice__close"
            onClick={() => setFlashMessage(null)}
            aria-label="Cerrar aviso"
          >
            <X size={15} aria-hidden="true" />
          </button>
        </div>
      )}

      <div className="panel">
        <div className="empty">
          <span className="empty__icon">
            <DoorOpen size={44} aria-hidden="true" />
          </span>
          <h2>Salas de la clínica</h2>
          <p>
            Usa “Agregar sala” para registrar una nueva sala disponible para la atención psicológica.
          </p>
        </div>
      </div>

      <button
        type="button"
        className="button button--primary fab"
        id="fab"
        onClick={() => setIsDialogOpen(true)}
      >
        <Plus size={18} aria-hidden="true" />
        Agregar sala
      </button>

      <AgregarSalaDialog
        isOpen={isDialogOpen}
        onClose={() => setIsDialogOpen(false)}
        onCreated={handleCreated}
        accessToken={session?.token}
      />

      <EliminarSalaDialog
        isOpen={isEliminarOpen}
        onClose={() => setIsEliminarOpen(false)}
        onDischarged={handleDischarged}
        accessToken={session?.token}
      />
    </div>
  );
}
