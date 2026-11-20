import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * DEF-004 (PG-DEF-ITER04). FullCalendar coloca cada cita con coordenadas en píxeles calculadas con
 * la rejilla de pantalla. Si los estilos de impresión cambian la altura de las filas, las citas se
 * desplazan respecto a su hora y la última sale cortada. jsdom no calcula diseño, así que se
 * verifica la hoja de estilos; la alineación medida en Chrome está en la evidencia del defecto.
 */
// Vitest se ejecuta desde apps/web (npm test del espacio de trabajo).
const css = readFileSync(path.join(process.cwd(), 'src/features/citas/styles/citas.css'), 'utf8');

function bloqueImpresion(hoja: string) {
  const inicio = hoja.indexOf('@media print {');
  expect(inicio).toBeGreaterThan(-1);
  let profundidad = 0;
  for (let i = hoja.indexOf('{', inicio); i < hoja.length; i += 1) {
    if (hoja[i] === '{') profundidad += 1;
    if (hoja[i] === '}') profundidad -= 1;
    if (profundidad === 0) return hoja.slice(inicio, i + 1);
  }
  throw new Error('Bloque @media print sin cerrar');
}

describe('impresión de la agenda (DEF-004)', () => {
  it('usa la misma altura de fila en pantalla y en impresión', () => {
    expect(css).toMatch(/\.ag-cal \.fc \.fc-timegrid-slot \{\s*height: var\(--ag-slot-alto\);/);
    const impresion = bloqueImpresion(css);
    expect(impresion).not.toMatch(/fc-timegrid-slot[^{]*\{[^}]*height/);
    expect(impresion).not.toMatch(/--ag-slot-alto/);
  });

  it('imprime en hoja horizontal con márgenes que dejan completa la jornada de 07:00 a 17:00', () => {
    const impresion = bloqueImpresion(css);
    expect(impresion).toMatch(/@page \{\s*size: landscape;\s*margin: 8mm;/);
  });
});
