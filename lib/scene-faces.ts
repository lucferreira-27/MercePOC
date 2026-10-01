import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import type { Face } from './furniture';

/**
 * Superfície da peça na cena, na medida real (mm): frente com moldura
 * (shaker), ripada, quadro vazado para o vidro, a tela ou a palhinha, e tampo
 * de borda boleada ou chanfrada. A peça continua uma só na lista de corte; só
 * a forma muda. Peça sem `face` segue a caixa unitária escalada de sempre.
 */
function piece(size: [number, number, number], at: [number, number, number]) {
  const g = new THREE.BoxGeometry(...size);
  g.translate(...at);
  return g;
}

/** As quatro réguas do quadro (montantes e travessas), na espessura toda. */
function frame(w: number, h: number, t: number, f: number) {
  return [
    piece([f, h, t], [-w / 2 + f / 2, 0, 0]),
    piece([f, h, t], [w / 2 - f / 2, 0, 0]),
    piece([w - 2 * f, f, t], [0, h / 2 - f / 2, 0]),
    piece([w - 2 * f, f, t], [0, -h / 2 + f / 2, 0]),
  ];
}

export function faceGeometry(face: Face, size: readonly [number, number, number]): THREE.BufferGeometry {
  const [w, h, t] = size;
  if (face.kind === 'edge') {
    // Tampo: a borda arredondada (ou o chanfro, que é o arredondado de um
    // segmento só) na espessura dele.
    const r = Math.max(0.5, Math.min(face.radius, h / 2 - 0.5, w / 2, t / 2));
    return mmUV(new RoundedBoxGeometry(w, h, t, face.profile === 'chamfer' ? 1 : 4, r));
  }
  // Chapa perfurada: a caixa na medida real, e os furos vêm da textura.
  if (face.kind === 'perforated') return mmUV(new THREE.BoxGeometry(w, h, t));
  let parts: THREE.BufferGeometry[];
  if (face.kind === 'slatted') {
    // Ripado: chapa de fundo e ripas de 8 mm na frente, verticais.
    const depth = Math.min(8, t / 2);
    const back = t - depth;
    const n = Math.max(1, Math.floor(w / face.pitch));
    const pitch = w / n;
    const slat = pitch * 0.62;
    parts = [piece([w, h, back], [0, 0, -t / 2 + back / 2])];
    for (let i = 0; i < n; i++) parts.push(piece([slat, h, depth], [-w / 2 + pitch * (i + 0.5), 0, t / 2 - depth / 2]));
  } else {
    const f = Math.max(10, Math.min(face.frame, w / 2 - 10, h / 2 - 10));
    parts = frame(w, h, t, f);
    // Shaker: o painel do meio, 6 mm mais fino, rebaixado na frente.
    if (face.kind === 'shaker') {
      const recess = Math.min(6, t / 3);
      parts.push(piece([w - 2 * f, h - 2 * f, t - recess], [0, 0, -recess / 2]));
    }
  }
  const merged = mergeGeometries(parts, false);
  for (const p of parts) p.dispose();
  return mmUV(merged ?? new THREE.BoxGeometry(w, h, t));
}

/** Chave da forma: muda a superfície ou a medida, refaz a geometria. */
export function faceKey(face: Face | undefined, size: readonly number[]) {
  return face ? `${JSON.stringify(face)}|${size.map((v) => Math.round(v)).join('x')}` : '';
}

/** Repetição da textura em mm, a mesma de `panelUV`: veio ao longo, poros através. */
const ALONG = 1400;
const ACROSS = 700;

/**
 * Coordenadas de textura em milímetros para uma geometria já na medida real:
 * em cada face o veio corre no lado mais longo da peça, como na caixa
 * unitária (`panelUV`), então madeira e pedra não esticam.
 */
export function mmUV(geometry: THREE.BufferGeometry) {
  geometry.computeBoundingBox();
  const box = geometry.boundingBox!;
  const size = [box.max.x - box.min.x, box.max.y - box.min.y, box.max.z - box.min.z];
  const position = geometry.getAttribute('position');
  const normal = geometry.getAttribute('normal');
  const uv = geometry.getAttribute('uv');
  if (!position || !normal || !uv) return geometry;
  for (let i = 0; i < position.count; i++) {
    const n = [Math.abs(normal.getX(i)), Math.abs(normal.getY(i)), Math.abs(normal.getZ(i))];
    const axis = n[0] >= n[1] && n[0] >= n[2] ? 0 : n[1] >= n[2] ? 1 : 2;
    const [a, b] = [0, 1, 2].filter((v) => v !== axis);
    const p = [position.getX(i) - box.min.x, position.getY(i) - box.min.y, position.getZ(i) - box.min.z];
    const [along, across] = size[a] >= size[b] ? [p[a], p[b]] : [p[b], p[a]];
    uv.setXY(i, along / ALONG, across / ACROSS);
  }
  uv.needsUpdate = true;
  return geometry;
}
