import { isFlat, type Composition, type ModularPart } from './composition';
import { drawingParts } from './fittings';

/**
 * Nada pode flutuar: toda peça desenhada (peça de corte ou ferragem: pé,
 * estrutura, cavalete, travessão, puxador, LED) tem de estar presa, por uma
 * corrente de peças que se tocam, ao piso, à parede (módulo suspenso, painel,
 * prateleira de parede) ou a outra peça. A colisão de peças só confere
 * sobreposição; isto confere o contrário, a peça solta no ar.
 *
 * Corrediça, dobradiça, trilho e a fresta das frentes (2 mm) seguram a frente
 * e a caixa da gaveta sem encostar: até `GAP` mm conta como preso. Vão maior
 * que isso pede uma peça de verdade.
 */
export const GAP = 15;

type Box = { min: number[]; max: number[] };

function worldBox(p: ModularPart): Box {
  const c = Math.cos(p.rotation ?? 0),
    s = Math.sin(p.rotation ?? 0);
  const [w, , d] = p.size;
  // Giro só em torno de y: a caixa do mundo cobre os quatro cantos no plano.
  const hx = Math.abs((w / 2) * c) + Math.abs((d / 2) * s),
    hz = Math.abs((w / 2) * s) + Math.abs((d / 2) * c);
  return {
    min: [p.position[0] - hx, p.position[1] - p.size[1] / 2, p.position[2] - hz],
    max: [p.position[0] + hx, p.position[1] + p.size[1] / 2, p.position[2] + hz],
  };
}

/** Maior distância entre as caixas num eixo (0 ou menos: encostam ou se cruzam). */
function gap(a: Box, b: Box) {
  return Math.max(...[0, 1, 2].map((i) => Math.max(a.min[i] - b.max[i], b.min[i] - a.max[i])));
}

export type Floating = { id: string; name: string; module: string };

/** As peças soltas do projeto: nenhuma corrente as liga ao piso, à parede ou à estrutura presa. */
export function floatingParts(d: Composition, drawn: readonly ModularPart[] = drawingParts(d)): Floating[] {
  const parts = drawn.filter((p) => !p.decal);
  const boxes = parts.map(worldBox);
  const floor = Math.min(...d.modules.map((m) => m.position[1]));
  // Presos de saída: o que toca o piso e as chapas de módulo preso na parede.
  const hung = new Set(d.modules.filter((m) => isFlat(m) || m.wall).map((m) => m.id));
  const held = parts.map((p, i) => boxes[i].min[1] <= floor + 1 || (p.owners.some((o) => hung.has(o)) && !p.name.startsWith('Pé') && p.kind !== 'drawer'));
  const queue = held.flatMap((v, i) => (v ? [i] : []));
  while (queue.length) {
    const i = queue.pop()!;
    for (let j = 0; j < parts.length; j++)
      if (!held[j] && gap(boxes[i], boxes[j]) <= GAP) {
        held[j] = true;
        queue.push(j);
      }
  }
  return parts.flatMap((p, i) => (held[i] ? [] : [{ id: p.id, name: p.name, module: p.owners[0] ?? '' }]));
}
