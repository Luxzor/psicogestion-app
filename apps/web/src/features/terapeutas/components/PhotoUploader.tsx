import type { DragEvent } from 'react';
import { useRef, useState } from 'react';
import { Camera, Image as ImageIcon, Upload } from 'lucide-react';
import type { PhotoData } from '../types';

function formatSize(bytes: number) {
  if (bytes >= 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

type PhotoUploaderProps = {
  photo: PhotoData | null;
  error?: string;
  uploadProgress?: number | null;
  disabled?: boolean;
  onPhotoSelect: (file: File) => void;
  onPhotoRemove: () => void;
};

/**
 * Selector y cargador de fotografía de terapeuta conforme a PG-DSN-002-INT 5.8.
 * Valida formato, peso y dimensiones (RF 2.1.11 a RF 2.1.13, CA-2.1-05).
 */
export function PhotoUploader({
  photo,
  error,
  uploadProgress,
  disabled,
  onPhotoSelect,
  onPhotoRemove,
}: PhotoUploaderProps) {
  const [isOver, setIsOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  function handleFile(file: File) {
    onPhotoSelect(file);
    if (inputRef.current) inputRef.current.value = '';
  }

  function handleDragOver(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    if (!disabled) setIsOver(true);
  }

  function handleDragLeave() {
    setIsOver(false);
  }

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setIsOver(false);
    if (disabled) return;
    const file = event.dataTransfer.files[0];
    if (file) handleFile(file);
  }

  const isUploading = typeof uploadProgress === 'number';

  return (
    <div className="photo-up" id="photo-up">
      <div className="photo-up__preview">
        {photo ? (
          <img src={photo.previewUrl} alt="Vista previa de la fotografía" />
        ) : (
          <Camera size={30} aria-hidden="true" />
        )}
      </div>

      <div className="photo-up__body">
        <div
          className={`photo-up__drop${isOver ? ' is-over' : ''}${error ? ' is-error' : ''}`}
          id="photo-drop"
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
        >
          <button
            type="button"
            className="button button--secondary"
            id="photo-pick"
            disabled={disabled || isUploading}
            onClick={() => inputRef.current?.click()}
          >
            {photo ? (
              <ImageIcon size={15} aria-hidden="true" />
            ) : (
              <Upload size={15} aria-hidden="true" />
            )}
            {photo ? 'Cambiar fotografía' : 'Elegir fotografía'}
          </button>

          {photo ? (
            <button
              type="button"
              className="text-button"
              id="photo-remove"
              disabled={disabled || isUploading}
              onClick={onPhotoRemove}
            >
              Quitar
            </button>
          ) : (
            <span>o arrástrala aquí</span>
          )}
        </div>

        {photo ? (
          <div className="photo-up__file">
            <strong>{photo.name}</strong>
            <span>
              {photo.width} x {photo.height} px
            </span>
            <span>{formatSize(photo.size)}</span>
          </div>
        ) : null}

        {isUploading ? (
          <div>
            <div className="progress-label">
              <span>Cargando fotografía</span>
              <span>{uploadProgress}%</span>
            </div>
            <div
              className="progress"
              role="progressbar"
              aria-label="Avance de carga de la fotografía"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={uploadProgress}
            >
              <span style={{ width: `${uploadProgress}%` }} />
            </div>
          </div>
        ) : null}

        {error ? (
          <span className="field-error" id="photo-error" role="alert">
            {error}
          </span>
        ) : null}

        <span className="field-hint">JPEG o PNG, hasta 5 MB y de al menos 200 x 200 píxeles.</span>
      </div>

      <input
        ref={inputRef}
        type="file"
        id="photo-input"
        accept="image/jpeg,image/png"
        tabIndex={-1}
        hidden
        aria-hidden="true"
        disabled={disabled || isUploading}
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) handleFile(file);
        }}
      />
    </div>
  );
}
