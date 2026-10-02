import { materialOf, type MaterialId } from './furniture';

/** Cor `#rrggbb` em CIELAB (D65), para medir diferença como o olho vê. */
function lab(hex: string): [number, number, number] {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const v = Number.parseInt(hex.slice(i, i + 2), 16) / 255;
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  const xyz = [(0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047, 0.2126 * r + 0.7152 * g + 0.0722 * b, (0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883];
  const [x, y, z] = xyz.map((t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116));
  return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
}

/** Diferença entre duas cores (ΔE 1976): até uns 2 não se nota, acima de 15 salta à vista. */
export function deltaE(a: string, b: string) {
  const [p, q] = [lab(a), lab(b)];
  return Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
}

/** Abaixo disto o gancho ou o puxador some na peça em que está (preto em preto, escovado em cinza). */
export const MIN_DELTA_E = 15;

/** Metais que trocam um pelo outro quando o escolhido some na peça. */
const METALS: MaterialId[] = ['steel-black', 'steel-brushed', 'brass'];

/**
 * O metal da ferragem (puxador, gancho) que aparece na peça: o escolhido,
 * se ele se destaca da cor dela; senão, o metal que mais se destaca.
 */
export function standOut(id: MaterialId, on: string): MaterialId {
  if (deltaE(materialOf(id).color, on) >= MIN_DELTA_E) return id;
  return METALS.reduce((best, m) => (deltaE(materialOf(m).color, on) > deltaE(materialOf(best).color, on) ? m : best), METALS[0]);
}
