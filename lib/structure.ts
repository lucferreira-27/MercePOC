import { generateComposition, isFlat, openingPose, type Composition, type ModularPart } from './composition';
import { cutPlan } from './cutplan';
import { drawingParts, fittingsOf } from './fittings';

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

/** Caixa no mundo de uma peça girada só em y (o mesmo `worldBox` de cima, para quem importa). */
const boxOfPart = (p: Pick<ModularPart, 'position' | 'size' | 'rotation'>) => worldBox(p as ModularPart);
/** Quanto duas caixas se cruzam (o menor dos três eixos); negativo, não se tocam. */
const overlap = (a: Box, b: Box) => Math.min(...[0, 1, 2].map((i) => Math.min(a.max[i], b.max[i]) - Math.max(a.min[i], b.min[i])));

export type StructureIssue = { kind: 'solta' | 'atravessa' | 'nao-abre' | 'puxador' | 'corte'; message: string };

/**
 * O que a colisão de peças de corte não vê, numa lista de frases: peça solta,
 * ferragem (pé, estrutura, cavalete, suporte, LED) atravessando peça de
 * corte, frente que não abre inteira porque bate numa peça ou ferragem,
 * puxador saindo da frente ou cruzando outro e peça de chapa maior que a
 * chapa. Fica de fora, de propósito: o contorno de aço rente às faces, que
 * toma o canto da caixa, e o pé inclinado entrando no nível que ele segura.
 */
export function structureIssues(d: Composition): StructureIssue[] {
  const out: StructureIssue[] = [];
  const g = generateComposition(d);
  const drawn = drawingParts(d).filter((p) => !p.decal);
  const cut = new Set(g.parts.map((p) => p.id));
  const fit = drawn.filter((p) => !cut.has(p.id));
  const fittings = fittingsOf(d, g.parts);
  const framed = new Set(d.modules.filter((m) => m.look?.frame).map((m) => m.id));
  const source = (p: ModularPart) => fittings.find((v) => p.id === v.id || p.id.startsWith(`${v.id}:seg-`));
  for (const f of floatingParts(d, drawn)) out.push({ kind: 'solta', message: `${f.name} solta no ar` });
  for (const f of fit) {
    const src = source(f);
    const fb = boxOfPart(f);
    for (const p of g.parts) {
      if (src?.attach === p.id) continue;
      // O contorno toma o canto das caixas com contorno (a dele e a vizinha na junta).
      if (src?.kind === 'frame' && framed.has(p.owners[0]) && ['side', 'top', 'base', 'back', 'divider', 'shelf', 'slab', 'panel'].includes(p.kind)) continue;
      if (src?.type === 'splayed' && p.kind === 'shelf') continue;
      const k = overlap(fb, boxOfPart(p));
      if (k > 3) out.push({ kind: 'atravessa', message: `${f.name} (${src?.type ?? ''}) atravessa ${p.name} em ${Math.round(k)} mm` });
    }
  }
  const groups = [...new Set(g.parts.filter((p) => p.motion).map((p) => p.motion!.id))];
  for (const group of groups) {
    const moving = g.parts.filter((p) => p.motion?.id === group);
    const own = new Set(fittings.filter((f) => f.kind === 'handle' && moving.some((p) => p.id === f.attach)).map((f) => f.id));
    const obstacles = [...g.parts.filter((p) => p.motion?.id !== group), ...fit.filter((f) => !own.has(f.id) && source(f)?.kind !== 'led')];
    for (const fr of [0.5, 1]) {
      const hit = moving.flatMap((p) => obstacles.filter((q) => overlap(boxOfPart(openingPose(p, fr)), boxOfPart(q)) > 1).map((q) => `${p.name} bate em ${q.name}`));
      if (hit.length) {
        out.push({ kind: 'nao-abre', message: `${hit[0]} abrindo ${Math.round(fr * 100)}%` });
        break;
      }
    }
  }
  const hs = fittings.filter((f) => f.kind === 'handle' && !f.hidden);
  for (const h of hs) {
    const front = g.parts.find((p) => p.id === h.attach);
    if (!front || !h.local) continue;
    const half = h.local.vertical ? front.size[1] / 2 : front.size[0] / 2;
    const along = h.local.vertical ? h.local.y : h.local.x;
    const across = h.local.vertical ? front.size[0] / 2 - Math.abs(h.local.x) : front.size[1] / 2 - Math.abs(h.local.y);
    if (Math.abs(along) + h.local.len / 2 > half + 1 || across < -1) out.push({ kind: 'puxador', message: `puxador ${h.type} sai de ${front.name}` });
  }
  for (let i = 0; i < hs.length; i++) for (let j = i + 1; j < hs.length; j++) if (overlap(boxOfPart(hs[i]), boxOfPart(hs[j])) > 0) out.push({ kind: 'puxador', message: `puxadores ${hs[i].type} se cruzam` });
  for (const o of cutPlan(g.parts).oversize) out.push({ kind: 'corte', message: `${o.name} (${o.c} × ${o.l}) não cabe numa chapa` });
  return out;
}
