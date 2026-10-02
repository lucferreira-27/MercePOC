import { type ModularPart } from './composition';
import { drawingParts } from './fittings';
import type { ChangeHighlight } from './progress';
import { applyStep, canonical, normalize, type Design, type ShelfOp } from './studio';
import type { Composition } from './composition';

/**
 * O que um turno mudou, peça por peça, e os quadros para ver a mudança
 * acontecer. É o "diff" do móvel: + peça nova, − peça que saiu, ~ peça que
 * mudou de medida, lugar ou acabamento.
 */
export type ChangeSign = '+' | '-' | '~';
export type PartDiff = {
  added: string[];
  changed: string[];
  /** Peças que saíram, com a pose de antes: a cena desenha o fantasma. */
  removed: ModularPart[];
};

/** Diferença abaixo disto é ruído de ponto flutuante, não mudança. */
const EPS = 0.5;
const moved = (a: ModularPart, b: ModularPart) =>
  a.size.some((v, i) => Math.abs(v - b.size[i]) > EPS) ||
  a.position.some((v, i) => Math.abs(v - b.position[i]) > EPS) ||
  Math.abs((a.rotation ?? 0) - (b.rotation ?? 0)) > 1e-3 ||
  a.color !== b.color;

export function partDiff(before: readonly ModularPart[], after: readonly ModularPart[]): PartDiff {
  const old = new Map(before.map((p) => [p.id, p]));
  const now = new Set(after.map((p) => p.id));
  const added: string[] = [];
  const changed: string[] = [];
  for (const part of after) {
    const prev = old.get(part.id);
    if (!prev) added.push(part.id);
    else if (moved(prev, part)) changed.push(part.id);
  }
  return { added, changed, removed: before.filter((p) => !now.has(p.id)) };
}

/** Diferença de dois projetos inteiros, pelas peças de desenho (com pés). */
export function designDiff(before: Design, after: Design): PartDiff {
  return partDiff(drawingParts(canonical(before)), drawingParts(canonical(after)));
}

/**
 * Quadros da mudança: o projeto depois de cada operação do lote, na ordem em
 * que a IA mandou. Um passo intermediário que ainda não fecha (módulo recém
 * criado antes de ser conectado, por exemplo) só entra se o desenho sair;
 * senão o quadro seguinte mostra o resultado dele. O último quadro é sempre o
 * resultado salvo.
 */
export function playbackFrames(before: Design, ops: readonly ShelfOp[], after: Design) {
  const frames: { design: Design; op: number }[] = [];
  let pending: Composition = canonical(before);
  for (const [i, op] of ops.entries()) {
    try {
      pending = applyStep(pending, op);
    } catch {
      // O lote salvo passou inteiro; se um passo isolado não reaplica, o
      // resultado final é o quadro que resta.
      break;
    }
    try {
      frames.push({ design: normalize(pending), op: i });
    } catch {
      // Passo que só fecha com o próximo: segue sem quadro.
    }
  }
  // Igual ao salvo peça por peça: a ordem das chaves e o ruído de ponto
  // flutuante não contam como mais um quadro.
  const last = frames.at(-1);
  const same = (d: PartDiff) => !d.added.length && !d.changed.length && !d.removed.length;
  if (!last || !same(designDiff(last.design, after)))
    frames.push({ design: normalize(after), op: ops.length - 1 });
  return frames;
}

/** Sinal de uma linha de mudança: da ferramenta, quando a linha não traz. */
export function signOf(h: Pick<ChangeHighlight, 'tool' | 'sign' | 'title'>): ChangeSign {
  if (h.sign) return h.sign;
  if (/remove|disconnect|merge/.test(h.tool)) return '-';
  if (/front\.set/.test(h.tool) && /removida/i.test(h.title)) return '-';
  if (/add|duplicate|split|connect|asset/.test(h.tool)) return '+';
  if (/front\.set/.test(h.tool)) return '+';
  return '~';
}

/** Contagem estilo "diffstat": linhas por sinal. */
export function diffStat(lines: readonly Pick<ChangeHighlight, 'tool' | 'sign' | 'title'>[]) {
  const stat = { '+': 0, '-': 0, '~': 0 } as Record<ChangeSign, number>;
  for (const l of lines) stat[signOf(l)]++;
  return stat;
}
