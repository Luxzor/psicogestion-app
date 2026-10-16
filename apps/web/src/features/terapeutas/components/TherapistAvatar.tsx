import { useTherapistPhoto } from '../hooks/useTherapistPhoto';

type Size = 'sm' | 'lg';

/** Iniciales del nombre (primer y último nombre), igual que la maqueta de PG-DSN-002 §5.2. */
function initialsOf(nombreCompleto: string) {
  const parts = nombreCompleto.trim().split(/\s+/).filter(Boolean);
  const first = parts[0]?.[0] ?? '';
  const last = parts.length > 1 ? parts[parts.length - 1][0] : '';
  return (first + last).toUpperCase();
}

/**
 * Avatar de terapeuta: miniatura de 40 px en la lista, foto de perfil más grande en el encabezado
 * del perfil; iniciales sobre fondo azul institucional mientras carga o si no hay fotografía
 * (PG-DSN-002 §5.2). Decorativo (el nombre ya aparece como texto junto al avatar).
 */
export function TherapistAvatar({
  therapistId,
  nombreCompleto,
  fotoActualizadaEn,
  accessToken,
  size = 'sm',
}: {
  therapistId: string;
  nombreCompleto: string;
  fotoActualizadaEn: string | null;
  accessToken: string;
  size?: Size;
}) {
  const tam = size === 'lg' ? 'perfil' : 'miniatura';
  const url = useTherapistPhoto(therapistId, tam, fotoActualizadaEn, accessToken);

  return (
    <span className={`avatar avatar--${size}`} aria-hidden="true">
      {url ? <img src={url} alt="" /> : initialsOf(nombreCompleto)}
    </span>
  );
}
