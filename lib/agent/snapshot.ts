import { layout } from '../composition';
import { describeLook } from '../look';
import { canonical, generateDesign, type Design } from '../studio';
import { fitSummary, type Room } from '../room';
import { mergePrices, money, quoteOf, type Prices, type QuoteAdjust } from '../quote';
import type { AgentContext } from './context';
import { sceneOf, sceneSummary } from './scene';

const r1 = (v: number) => Math.round(v * 10) / 10;

/**
 * Estado do projeto em forma compacta para a IA: módulos, compartimentos com
 * os ids reais, ambiente e o veredito de encaixe. É o mesmo texto no pedido
 * e na ferramenta `state_read`, para a IA não ver dois formatos do mesmo dado.
 */
export function designSnapshot(design: Design, room: Room | undefined) {
  const cells = layout(canonical(design)).cells;
  return {
    ...(design.style ? { estilo: design.style } : {}),
    medidas_gerais_mm: { largura: r1(design.width), altura: r1(design.height), profundidade: r1(design.depth) },
    modulos: design.modules.map((m) => ({
      id: m.id,
      nome: m.name,
      ...(m.kind ? { tipo: m.kind } : {}),
      largura: m.width,
      altura: m.height,
      profundidade: m.depth,
      material: m.materialId,
      ...(m.feet ? { pes: m.feet } : {}),
      ...(m.wall ? { suspenso: true } : {}),
      ...(m.rotation ? { rotacao: m.rotation } : {}),
      posicao: m.position.map(r1),
      ...(m.back || m.kind ? {} : { sem_fundo: true }),
      ...(m.shelves ? { niveis: m.shelves } : {}),
      ...(m.drawers ? { gavetas: m.drawers } : {}),
      ...(m.hooks ? { ganchos: m.hooks } : {}),
      // Acabamento em frases curtas: o que a pessoa vê (base, puxador, frente, tampo).
      ...(m.look ? { acabamento: describeLook(m).join('; ') } : {}),
    })),
    conexoes: design.connections.map((c) => ({
      pai: c.parent,
      filho: c.child,
      lado: c.side,
      compartilhado: c.shared,
      ...(c.offset ? { deslocamento: c.offset } : {}),
    })),
    // Prateleiras soltas do primeiro módulo (sh-N): mover pela altura exata
    // com a operação move, sem recalcular vãos a partir de números arredondados.
    ...(design.shelves?.length ? { prateleiras: design.shelves.map((v) => ({ id: v.id, altura_mm: r1(v.elevation) })) } : {}),
    compartimentos: cells.map((c) => ({
      id: c.id,
      modulo: c.moduleId,
      rotulo: c.label,
      tamanho: c.size.map(r1),
      ...(c.node.split
        ? { dividido: c.node.split.axis, filhos: c.node.split.children.map((v) => v.id) }
        : {}),
      ...(c.node.front
        ? {
            frente: {
              id: c.node.front.id,
              tipo: c.node.front.type,
              ...(c.node.front.type === 'drawers' ? { gavetas: c.node.front.heights.length } : {}),
              ...(c.node.front.materialId ? { material: c.node.front.materialId } : {}),
              ...(c.node.front.style ? { estilo: c.node.front.style } : {}),
              ...(c.node.front.handle ? { puxador: c.node.front.handle } : {}),
            },
          }
        : {}),
    })),
    ...(room
      ? {
          ambiente: {
            parede_mm: { largura: room.widthMm, altura: room.heightMm, ...(room.depthMm ? { profundidade: room.depthMm } : {}) },
            obstaculos: (room.obstacles ?? []).map((o) => ({
              id: o.id,
              tipo: o.kind,
              ...(o.label ? { nome: o.label } : {}),
              x: o.xMm,
              y: o.yMm,
              largura: o.widthMm,
              altura: o.heightMm,
            })),
            // Paredes além da do fundo, em planta: x do canto, z da face do fundo.
            ...(room.walls?.length
              ? {
                  paredes: room.walls.map((w) => ({
                    id: w.id,
                    ...(w.label ? { nome: w.label } : {}),
                    direcao: w.rotation === 90 ? 'sai do fundo' : 'ao longo do fundo',
                    x: w.xMm,
                    z: w.zMm,
                    comprimento: w.widthMm,
                    altura: Math.min(w.heightMm, room.heightMm),
                    espessura: w.thicknessMm,
                  })),
                }
              : {}),
            encaixe: fitSummary(design, room),
          },
        }
      : {}),
  };
}

/**
 * O que está selecionado na tela, com o nome que a pessoa vê e o módulo de
 * cada item. Só com os ids ("faixa-topo:panel") no fim do estado, a IA
 * ignorava a seleção e escolhia os dois módulos mais parecidos entre si.
 */
export function selectionFacts(design: Design, ids: readonly string[]) {
  const g = generateDesign(design);
  const cells = layout(canonical(design)).cells;
  return ids.flatMap((id) => {
    const part = g.parts.find((p) => p.id === id);
    const cell = cells.find((c) => c.id === id || c.node.front?.id === id);
    const owners = design.modules.some((m) => m.id === id) ? [id] : (part?.owners ?? (cell ? [cell.moduleId] : []));
    const modules = owners.flatMap((o) => design.modules.filter((m) => m.id === o));
    if (!part && !cell && !modules.length) return [];
    return [
      {
        id,
        nome: part?.name ?? (cell?.id === id ? cell.label : undefined) ?? modules[0]?.name ?? id,
        ...(cell?.node.front?.id === id ? { frente: cell.node.front.type } : {}),
        ...(cell && !part ? { vao_mm: cell.size.map(r1) } : {}),
        modulos: modules.map((m) => ({ id: m.id, nome: m.name, largura: m.width, altura: m.height, profundidade: m.depth })),
      },
    ];
  });
}

/** Linha da seleção logo antes do pedido: nome e medida de cada item. */
export function selectionLine(design: Design, ids: readonly string[]) {
  const facts = selectionFacts(design, ids);
  if (!facts.length) return '';
  const items = facts.map((f) => {
    const where = f.modulos.map((m) => `módulo ${m.id}, ${m.largura} × ${m.altura} × ${m.profundidade} mm`).join('; ');
    return `${f.nome} (${f.id}${where ? `; ${where}` : ''})`;
  });
  return `Selecionado na tela (${facts.length}): ${items.join(' | ')}. Quando o pedido aponta sem nomear a peça ("este", "esse", "esses", "os dois", "isso", "o menor"), o alvo é esta seleção.`;
}

/** Orçamento e chapas em uma linha, com a tabela de preços do navegador. */
export function quoteLine(design: Design, prices: Prices, adjust?: QuoteAdjust) {
  try {
    const q = quoteOf(canonical(design), mergePrices(prices), adjust);
    const sheets = q.plan.groups
      .map((g) => `${g.sheets}× ${g.material} ${g.thickness} mm (${Math.round(g.efficiency * 100)}%)`)
      .join('; ');
    const manual = q.adjusted
      ? ` Ajustes à mão no orçamento: ${[...q.removed.map((l) => `tirado "${l.label}"`), ...q.lines.filter((l) => l.computedQty !== undefined).map((l) => `"${l.label}" com ${l.qty} ${l.unit} (calculado ${l.computedQty})`), ...q.lines.filter((l) => l.extra).map((l) => `item à parte "${l.label}" ${l.qty} ${l.unit} × ${money(l.unitPrice)}`)].join('; ')}.`
      : '';
    return `Orçamento estimado: total ${money(q.total)} (custo ${money(q.cost)} + margem ${money(q.marginValue)}, ${mergePrices(prices).margin}%); chapas: ${sheets}; ${q.counts.doors} portas, ${q.counts.drawers} gavetas, ${q.counts.edgeMeters} m de fita.${manual}`;
  } catch {
    return '';
  }
}

/** Estado completo do rascunho, para `state_read` e para o pedido do turno. */
export function contextSnapshot(ctx: AgentContext) {
  const p = ctx.project;
  return {
    projeto: p.name,
    versao: `${p.cursor + 1} de ${p.revisions.length}`,
    // Móvel de partida que ninguém pediu (projeto novo, sem pedido anterior):
    // pedido de móvel novo troca ele, em vez de pôr ao lado.
    ...(p.revisions.length === 1 && p.messages.filter((m) => m.role === 'user').length <= 1 ? { projeto_inicial: true } : {}),
    ...(ctx.designChanged || ctx.roomChanged ? { rascunho: 'mudanças deste pedido ainda não gravadas' } : {}),
    ...designSnapshot(ctx.design, ctx.room),
    // A parede em coordenadas de quem desenha (x do canto, y do piso): o que
    // está fixo, o que ocupa e onde cabe. É com isto que place e modify contam.
    parede: sceneSummary(sceneOf(ctx.design, ctx.room)),
    selecao: selectionFacts(ctx.design, ctx.selected),
    ...(ctx.ui ? { tela: ctx.ui } : {}),
  };
}
