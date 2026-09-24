import { ClipboardList } from 'lucide-react';

export function CitasPage() {
  return (
    <div className="page-placeholder">
      <span className="page-placeholder__icon">
        <ClipboardList size={52} />
      </span>
      <h2>Citas</h2>
      <p>
        Aquí podrás agendar, modificar y cancelar citas. Se implementará en la siguiente iteración.
      </p>
    </div>
  );
}
