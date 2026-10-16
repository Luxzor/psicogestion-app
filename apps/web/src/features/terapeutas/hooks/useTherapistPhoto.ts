import { useEffect, useState } from 'react';
import { therapistsApi } from '../api';
import type { PhotoSize } from '../types';

/** Descargas simultáneas de fotografía: la lista puede mostrar hasta 25 filas a la vez. */
const MAX_CONCURRENT_DOWNLOADS = 6;
let activeDownloads = 0;
const pendingSlots: Array<() => void> = [];

function acquireSlot(): Promise<() => void> {
  return new Promise((resolve) => {
    const tryAcquire = () => {
      if (activeDownloads < MAX_CONCURRENT_DOWNLOADS) {
        activeDownloads += 1;
        resolve(() => {
          activeDownloads -= 1;
          pendingSlots.shift()?.();
        });
      } else {
        pendingSlots.push(tryAcquire);
      }
    };
    tryAcquire();
  });
}

/**
 * Descarga la fotografía de un terapeuta como Blob (GET .../foto?tam=, ERS 2.1.6: sin URLs
 * públicas). La descarga se repite solo si cambia el id, el tamaño o `foto_actualizada_en`
 * (cuando se reemplaza la foto); se limita la concurrencia para no saturar la lista y el object
 * URL se libera al desmontar la fila o al cambiar cualquiera de esas dependencias, por ejemplo al
 * paginar.
 */
export function useTherapistPhoto(
  therapistId: string,
  tam: PhotoSize,
  fotoActualizadaEn: string | null,
  accessToken: string,
) {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!fotoActualizadaEn) return;

    let cancelled = false;
    let objectUrl: string | null = null;
    const controller = new AbortController();

    void (async () => {
      const release = await acquireSlot();
      try {
        const blob = await therapistsApi.getPhotoBlob(therapistId, tam, accessToken, controller.signal);
        if (cancelled || !blob) return;
        objectUrl = URL.createObjectURL(blob);
        setUrl(objectUrl);
      } catch {
        // Sin conexión, error del servidor o descarga cancelada: se muestran las iniciales.
      } finally {
        release();
      }
    })();

    return () => {
      cancelled = true;
      controller.abort();
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
        setUrl((current) => (current === objectUrl ? null : current));
      }
    };
  }, [therapistId, tam, fotoActualizadaEn, accessToken]);

  // Derivado en el render, no solo del estado: si fotoActualizadaEn ya es null (foto quitada),
  // no hay que esperar a que corra la limpieza del efecto para dejar de mostrar la imagen vieja.
  return fotoActualizadaEn ? url : null;
}
