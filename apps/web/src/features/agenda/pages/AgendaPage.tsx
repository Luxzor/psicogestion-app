import { CalendarDays } from 'lucide-react';

export function AgendaPage() {
  return (
    <div className="page-placeholder">
      <span className="page-placeholder__icon">
        <CalendarDays size={52} />
      </span>
      <h2>Agenda</h2>
      <p>
        La vista de agenda con filtros por día, semana y mes se implementará en la siguiente
        iteración.
      </p>
    </div>
  );
}
