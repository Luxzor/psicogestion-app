import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { AppError } from './errors.js';

const currentFile = fileURLToPath(import.meta.url);
const projectRoot = path.resolve(path.dirname(currentFile), '../../../../');
const DEFAULT_STORAGE_DIR = path.join(projectRoot, 'uploads');

export const MAX_PHOTO_BYTES = 5 * 1024 * 1024; // 5 MB
export const MIN_PHOTO_DIMENSION = 200; // 200 x 200 px

export type ImageInfo = {
  format: 'jpeg' | 'png';
  width: number;
  height: number;
};

/**
 * Inspecciona los bytes iniciales y los encabezados para determinar
 * formato real (JPEG o PNG) y dimensiones sin dependencias nativas externas.
 */
export function inspectImage(buffer: Buffer): ImageInfo {
  if (buffer.length > MAX_PHOTO_BYTES) {
    throw new AppError(413, 'FOTO_MUY_GRANDE', 'La fotografía no puede pesar más de 5 MB.');
  }

  // Comprobar PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    buffer.length >= 24 &&
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a
  ) {
    const width = buffer.readUInt32BE(16);
    const height = buffer.readUInt32BE(20);
    if (width <= 0 || height <= 0) {
      throw new AppError(422, 'FOTO_CORRUPTA', 'El archivo de imagen está dañado o no es legible.');
    }
    validateDimensions(width, height);
    return { format: 'png', width, height };
  }

  // Comprobar JPEG: FF D8 FF
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    let offset = 2;
    while (offset < buffer.length) {
      if (buffer[offset] !== 0xff) {
        offset++;
        continue;
      }
      while (buffer[offset] === 0xff && offset < buffer.length) {
        offset++;
      }
      if (offset >= buffer.length) break;
      const marker = buffer[offset++];
      // EOI (End of image) o SOS (Start of scan)
      if (marker === 0xd9 || marker === 0xda) break;
      if (offset + 2 > buffer.length) break;
      const length = buffer.readUInt16BE(offset);
      // Marcadores SOF (Start of Frame) que contienen dimensiones
      const isSof = [
        0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf,
      ].includes(marker);

      if (isSof) {
        if (offset + 7 > buffer.length) {
          throw new AppError(
            422,
            'FOTO_CORRUPTA',
            'El archivo de imagen está dañado o no es legible.',
          );
        }
        const height = buffer.readUInt16BE(offset + 3);
        const width = buffer.readUInt16BE(offset + 5);
        if (width <= 0 || height <= 0) {
          throw new AppError(
            422,
            'FOTO_CORRUPTA',
            'El archivo de imagen está dañado o no es legible.',
          );
        }
        validateDimensions(width, height);
        return { format: 'jpeg', width, height };
      }
      offset += length;
    }
    throw new AppError(422, 'FOTO_CORRUPTA', 'El archivo de imagen está dañado o no es legible.');
  }

  throw new AppError(
    415,
    'FOTO_FORMATO_INVALIDO',
    'El formato de la imagen no es válido. Usa JPEG o PNG.',
  );
}

function validateDimensions(width: number, height: number) {
  if (width < MIN_PHOTO_DIMENSION || height < MIN_PHOTO_DIMENSION) {
    throw new AppError(
      422,
      'FOTO_DIMENSIONES_INSUFICIENTES',
      `La fotografía debe medir al menos ${MIN_PHOTO_DIMENSION} x ${MIN_PHOTO_DIMENSION} píxeles (la recibida mide ${width} x ${height}).`,
      undefined,
      { ancho: width, alto: height },
    );
  }
}

/**
 * Extrae el archivo con nombre "foto" de un cuerpo multipart/form-data.
 */
export function extractMultipartFile(body: Buffer, contentTypeHeader: string | undefined): Buffer {
  if (!contentTypeHeader || !contentTypeHeader.includes('boundary=')) {
    return body;
  }

  const boundaryMatch = contentTypeHeader.match(/boundary=([^;]+)/i);
  if (!boundaryMatch) {
    return body;
  }
  const boundary = boundaryMatch[1].trim().replace(/^["']|["']$/g, '');
  const boundaryBuf = Buffer.from(`--${boundary}`);
  const start = body.indexOf(boundaryBuf);
  if (start === -1) {
    throw new AppError(400, 'VALIDACION_INVALIDA', 'No se encontró el archivo en la solicitud.');
  }

  const headerEnd = body.indexOf(Buffer.from('\r\n\r\n'), start);
  if (headerEnd === -1) {
    throw new AppError(400, 'VALIDACION_INVALIDA', 'Formato multipart no válido.');
  }

  const nextBoundary = body.indexOf(boundaryBuf, headerEnd + 4);
  if (nextBoundary === -1) {
    throw new AppError(400, 'VALIDACION_INVALIDA', 'Formato multipart no válido.');
  }

  const fileData = body.subarray(headerEnd + 4, nextBoundary - 2);
  if (fileData.length === 0) {
    throw new AppError(400, 'VALIDACION_INVALIDA', 'El archivo de fotografía está vacío.');
  }

  return fileData;
}

export const photoStorage = {
  getStorageDir() {
    return process.env.STORAGE_DIR || DEFAULT_STORAGE_DIR;
  },

  async save(
    therapistId: string,
    buffer: Buffer,
    format: 'jpeg' | 'png',
  ): Promise<{ storageKey: string; fullPath: string }> {
    const ext = format === 'jpeg' ? 'jpg' : 'png';
    const relativeKey = `terapeutas/${therapistId}/perfil.${ext}`;
    const fullPath = path.join(this.getStorageDir(), relativeKey);
    await fs.promises.mkdir(path.dirname(fullPath), { recursive: true });
    await fs.promises.writeFile(fullPath, buffer);
    return { storageKey: relativeKey, fullPath };
  },

  async get(storageKey: string): Promise<Buffer | null> {
    const fullPath = path.join(this.getStorageDir(), storageKey);
    try {
      return await fs.promises.readFile(fullPath);
    } catch {
      return null;
    }
  },

  async delete(storageKey: string): Promise<void> {
    const fullPath = path.join(this.getStorageDir(), storageKey);
    try {
      await fs.promises.unlink(fullPath);
    } catch {
      // Ignorar si el archivo no existe
    }
  },
};
