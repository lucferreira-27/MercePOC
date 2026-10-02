import { generateComposition, isFlat, openingPose, type Composition, type ModularPart } from './composition';
import { deltaE, MIN_DELTA_E } from './color';
import { cutPlan } from './cutplan';
import { drawingParts, fittingsOf } from './fittings';

/**
 * Nada pode flutuar: toda peça desenhada (peça de corte ou ferragem: pé,
 * estrutura, cavalete, travessão, puxador, LED) tem de estar presa, por uma
 * corrente de peças que se tocam, ao piso, à parede (módulo suspenso, painel,
 * prateleira de parede) ou a outra peça. A colisão de peças só confere
 * sobreposição; isto confere o contrário, a peça solta no ar.
 *
 * Peça parada tem de encostar (`TOUCH`, 1 mm): com 15 mm de folga para
 * tudo, um nível a 2 mm dos pés e uma moldura a 2 mm da caixa passavam como
 * presos e apareciam soltos no desenho. Só frente e gaveta, que corrediça,
 * dobradiça e trilho seguram sem encostar, têm a folga de `GAP` mm.
 */
export const GAP = 15;
/** Peça parada (chapa, tampo, nível, pé, estrutura) tem de encostar: até 1 mm. */
export const TOUCH = 1;

type Box = { min: number[]; max: number[] };

function worldBox(p: ModularPart): Box {
  const c = Math.cos(p.rotation ?? 0),
    s = Math.sin(p.rotation ?? 0);
  // Pé inclinado: a caixa cobre do encaixe à ponta no piso.
  const [ox, oz] = p.slant ?? [0, 0];
  const w = p.size[0] + Math.abs(ox),
    d = p.size[2] + Math.abs(oz);
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
      // A folga de ferragem (corrediça, dobradiça, fresta) vale só para frente e gaveta, que se movem.
      if (!held[j] && gap(boxes[i], boxes[j]) <= (parts[i].motion || parts[j].motion ? GAP : TOUCH)) {
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

export type StructureIssue = { kind: 'solta' | 'atravessa' | 'cruza' | 'escondida' | 'contraste' | 'apoio' | 'nao-abre' | 'puxador' | 'corte'; message: string };

/**
 * Junta de verdade (canto soldado, travessa entrando no pé): a parte comum
 * fica na ponta de pelo menos uma das peças. Peça atravessando o meio da
 * outra, ou um pé dentro do outro, não é junta.
 */
function joint(a: Box, b: Box) {
  const o: Box = { min: [0, 1, 2].map((i) => Math.max(a.min[i], b.min[i])), max: [0, 1, 2].map((i) => Math.min(a.max[i], b.max[i])) };
  const atEnd = (x: Box) => {
    const span = [0, 1, 2].map((i) => x.max[i] - x.min[i]);
    const ax = span.indexOf(Math.max(...span));
    const cross = Math.max(...span.filter((_, i) => i !== ax));
    return span[ax] > 2 * cross && (o.max[ax] <= x.min[ax] + cross + 1 || o.min[ax] >= x.max[ax] - cross - 1);
  };
  return atEnd(a) || atEnd(b);
}
const inside = (a: Box, b: Box) => [0, 1, 2].every((i) => a.min[i] >= b.min[i] - 0.5 && a.max[i] <= b.max[i] + 0.5);

/**
 * O que a colisão de peças de corte não vê, numa lista de frases: peça solta,
 * ferragem (pé, estrutura, cavalete, suporte, LED) atravessando peça de
 * corte, frente que não abre inteira porque bate numa peça ou ferragem,
 * puxador saindo da frente ou cruzando outro e peça de chapa maior que a
 * chapa. Fica de fora, de propósito: o contorno de aço rente às faces, que
 * toma o canto da caixa, e o pé inclinado entrando no nível que ele segura.
 */
export function structureIssues(d: Composition, all: readonly ModularPart[] = drawingParts(d)): StructureIssue[] {
  const out: StructureIssue[] = [];
  const g = generateComposition(d);
  const drawn = all.filter((p) => !p.decal);
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
      // O nível da mesa entra nos pés e no quadro que o seguram (entalhado, apoiado).
      if ((src?.kind === 'leg' || src?.kind === 'stand') && p.kind === 'shelf' && p.id.includes(':level-') && p.owners.includes(src.moduleId)) continue;
      const k = overlap(fb, boxOfPart(p));
      if (k > 3) out.push({ kind: 'atravessa', message: `${f.name} (${src?.type ?? ''}) atravessa ${p.name} em ${Math.round(k)} mm` });
    }
  }
  // Ferragem contra ferragem: pé dentro de pé, cavalete no outro, tubo cruzando o que não é a junta dele.
  const fb = fit.map(boxOfPart);
  const fsrc = fit.map(source);
  for (let i = 0; i < fit.length; i++)
    for (let j = i + 1; j < fit.length; j++) {
      const [a, b] = [fsrc[i], fsrc[j]];
      if (!a || !b || a === b) continue;
      const k = overlap(fb[i], fb[j]);
      if (k > 3 && !joint(fb[i], fb[j])) out.push({ kind: 'cruza', message: `${fit[i].name} (${a.type}) cruza ${fit[j].name} (${b.type}) em ${Math.round(k)} mm` });
    }
  // Peça que some: ferragem inteira dentro de uma peça de corte não aparece no desenho nem na cena.
  const cb = g.parts.map(boxOfPart);
  for (let i = 0; i < fit.length; i++) {
    const host = g.parts.findIndex((_, j) => inside(fb[i], cb[j]));
    if (host >= 0) out.push({ kind: 'escondida', message: `${fit[i].name} (${fsrc[i]?.type ?? ''}) some dentro de ${g.parts[host].name}` });
  }
  // Gancho e puxador da mesma cor da peça: não se vê (gancho preto em painel preto).
  for (let i = 0; i < fit.length; i++) {
    const v = fsrc[i];
    // A cava e o recorte são sombra usinada na frente, não metal: ficam de fora.
    if ((v?.kind !== 'handle' && v?.kind !== 'hook') || v.type === 'groove' || v.type === 'cutout') continue;
    const on = v.attach ? g.parts.find((p) => p.id === v.attach) : g.parts.find((p, j) => p.owners.includes(v.moduleId) && gap(fb[i], cb[j]) <= TOUCH);
    if (on && deltaE(fit[i].color, on.color) < MIN_DELTA_E) out.push({ kind: 'contraste', message: `${fit[i].name} (${v.type}) some na cor de ${on.name}` });
  }
  // Avental e travessa: as duas pontas encostam num pé, no cavalete ou no quadro; ponta no ar é peça mal medida.
  // O canto de avental com avental é junta de verdade (respiga, cavilha): também segura.
  const holds = [...fit.flatMap((f, i) => (fsrc[i]?.kind === 'leg' || fsrc[i]?.kind === 'stand' || fsrc[i]?.kind === 'frame' ? [fb[i]] : [])), ...g.parts.flatMap((p, j) => (p.kind === 'apron' ? [cb[j]] : []))];
  for (const p of g.parts) {
    if (p.kind !== 'apron') continue;
    const m = d.modules.find((v) => p.owners.includes(v.id));
    if (!m || m.wall) continue;
    const b = cb[g.parts.indexOf(p)];
    const ax = b.max[0] - b.min[0] >= b.max[2] - b.min[2] ? 0 : 2;
    for (const end of [b.min[ax], b.max[ax]]) {
      const tip: Box = { min: [...b.min], max: [...b.max] };
      tip.min[ax] = tip.max[ax] = end;
      if (!holds.some((h) => h !== b && gap(tip, h) <= TOUCH)) out.push({ kind: 'apoio', message: `${p.name} tem uma ponta no ar, sem pé nem quadro` });
    }
  }
  const groups = [...new Set(g.parts.filter((p) => p.motion).map((p) => p.motion!.id))];
  for (const group of groups) {
    const moving = g.parts.filter((p) => p.motion?.id === group);
    const own = new Set(fittings.filter((f) => f.kind === 'handle' && moving.some((p) => p.id === f.attach)).map((f) => f.id));
    // Cava e recorte são usinados na frente: não saem dela, não batem em nada.
    const flush = (f: ModularPart) => { const v = source(f); return v?.kind === 'led' || v?.type === 'groove' || v?.type === 'cutout'; };
    const obstacles = [...g.parts.filter((p) => p.motion?.id !== group), ...fit.filter((f) => !own.has(f.id) && !flush(f))];
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
