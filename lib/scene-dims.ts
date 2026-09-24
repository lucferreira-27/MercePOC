import * as THREE from 'three';
import type { Part } from './furniture';
import type { Room } from './room';
import type { SceneBounds } from './scene-room';

/**
 * Cotas da cena: linhas no espaço 3D e rótulos que a página posiciona em HTML
 * a cada quadro. Medida geral (largura, altura, profundidade), largura de cada
 * módulo em cima e, com ambiente informado, o espaço livre até a parede.
 */
export type DimLabel = { text: string; at: THREE.Vector3; tone: 'main' | 'module' | 'free' };

/** Centímetros com uma casa no máximo, vírgula decimal: "80" ou "158,2". */
export function cmLabel(mm: number) {
  return `${String(Number((mm / 10).toFixed(1))).replace('.', ',')} cm`;
}

export function moduleSpans(parts: readonly Part[]) {
  const spans = new Map<string, { min: number; max: number; top: number }>();
  for (const part of parts) {
    const owners = (part as { owners?: string[] }).owners ?? [];
    // Painel compartilhado tem dois donos: a largura de cada módulo inclui o
    // painel, então as cotas somam mais que a geral, como numa planta.
    const turned = Math.round(((part.rotation ?? 0) * 180) / Math.PI) % 180 !== 0;
    const w = turned ? part.size[2] : part.size[0];
    const lo = part.position[0] - w / 2,
      hi = part.position[0] + w / 2,
      top = part.position[1] + part.size[1] / 2;
    for (const owner of owners) {
      const s = spans.get(owner);
      if (s) {
        s.min = Math.min(s.min, lo);
        s.max = Math.max(s.max, hi);
        s.top = Math.max(s.top, top);
      } else spans.set(owner, { min: lo, max: hi, top });
    }
  }
  return [...spans.values()].sort((a, b) => a.min - b.min);
}

export function buildDims(parts: readonly Part[], bounds: SceneBounds, room: Room | undefined, color: string) {
  const [x0, y0, z0] = bounds.min;
  const [x1, y1, z1] = bounds.max;
  const points: number[] = [];
  const labels: DimLabel[] = [];
  const tick = 40;
  const seg = (a: THREE.Vector3, b: THREE.Vector3) => points.push(a.x, a.y, a.z, b.x, b.y, b.z);
  /** Linha de cota com traços de chamada nas pontas, na direção `out`. */
  const dim = (a: THREE.Vector3, b: THREE.Vector3, out: THREE.Vector3, text: string, tone: DimLabel['tone']) => {
    seg(a, b);
    for (const p of [a, b]) seg(p.clone().addScaledVector(out, -tick), p.clone().addScaledVector(out, tick * 0.6));
    labels.push({ text, at: a.clone().add(b).multiplyScalar(0.5), tone });
  };
  const front = z1 + 140;
  dim(new THREE.Vector3(x0, 0, front), new THREE.Vector3(x1, 0, front), new THREE.Vector3(0, 0, 1), cmLabel(x1 - x0), 'main');
  dim(new THREE.Vector3(x0 - 140, y0, z1), new THREE.Vector3(x0 - 140, y1, z1), new THREE.Vector3(-1, 0, 0), cmLabel(y1 - y0), 'main');
  // Profundidade no lado esquerdo, junto da altura: à direita ela disputava
  // lugar com o espaço livre até a parede.
  dim(new THREE.Vector3(x0 - 140, 0, z0), new THREE.Vector3(x0 - 140, 0, z1), new THREE.Vector3(-1, 0, 0), cmLabel(z1 - z0), 'main');
  const spans = moduleSpans(parts);
  if (spans.length > 1) {
    const seen = new Set<string>();
    for (const s of spans) {
      const key = `${Math.round(s.min)}:${Math.round(s.max)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const y = s.top + 110;
      dim(new THREE.Vector3(s.min, y, z1), new THREE.Vector3(s.max, y, z1), new THREE.Vector3(0, 1, 0), cmLabel(s.max - s.min), 'module');
    }
  }
  // Espaço livre até a parede: numa segunda linha, afastada das cotas do
  // móvel, para os rótulos não caírem uns sobre os outros.
  if (room) {
    const wallBegin = x0 - (room.offsetMm ?? 0);
    const wallEnd = wallBegin + room.widthMm;
    if (x0 - wallBegin > 5)
      dim(new THREE.Vector3(wallBegin, 0, front + 260), new THREE.Vector3(x0, 0, front + 260), new THREE.Vector3(0, 0, 1), `livre ${cmLabel(x0 - wallBegin)}`, 'free');
    if (wallEnd - x1 > 5)
      dim(new THREE.Vector3(x1, 0, front + 260), new THREE.Vector3(wallEnd, 0, front + 260), new THREE.Vector3(0, 0, 1), `livre ${cmLabel(wallEnd - x1)}`, 'free');
    if (room.heightMm - y1 > 5)
      dim(
        new THREE.Vector3(x0 - 360, y1, z1),
        new THREE.Vector3(x0 - 360, room.heightMm, z1),
        new THREE.Vector3(-1, 0, 0),
        `livre ${cmLabel(room.heightMm - y1)}`,
        'free',
      );
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(points, 3));
  const material = new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.85, depthTest: false });
  const lines = new THREE.LineSegments(geometry, material);
  lines.renderOrder = 10;
  return {
    lines,
    labels,
    dispose() {
      geometry.dispose();
      material.dispose();
    },
  };
}
