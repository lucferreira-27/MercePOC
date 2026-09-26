import { layout, type ModularPart } from '../composition';
import { canonical, generateDesign, type Design } from '../studio';
import { fitSummary, type Room } from '../room';
import { mergePrices, money, quote, type Prices } from '../quote';
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
      ...(m.back ? {} : { sem_fundo: true }),
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
            encaixe: fitSummary(design, room),
          },
        }
      : {}),
  };
}

/** Orçamento e chapas em uma linha, com a tabela de preços do navegador. */
export function quoteLine(design: Design, prices: Prices) {
  try {
    const q = quote(generateDesign(design).parts as ModularPart[], design.modules.length, mergePrices(prices));
    const sheets = q.plan.groups
      .map((g) => `${g.sheets}× ${g.material} ${g.thickness} mm (${Math.round(g.efficiency * 100)}%)`)
      .join('; ');
    return `Orçamento estimado: total ${money(q.total)} (custo ${money(q.cost)} + margem ${money(q.marginValue)}, ${mergePrices(prices).margin}%); chapas: ${sheets}; ${q.counts.doors} portas, ${q.counts.drawers} gavetas, ${q.counts.edgeMeters} m de fita.`;
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
    ...(ctx.designChanged || ctx.roomChanged ? { rascunho: 'mudanças deste pedido ainda não gravadas' } : {}),
    ...designSnapshot(ctx.design, ctx.room),
    // A parede em coordenadas de quem desenha (x do canto, y do piso): o que
    // está fixo, o que ocupa e onde cabe. É com isto que place e modify contam.
    parede: sceneSummary(sceneOf(ctx.design, ctx.room)),
    selecao: ctx.selected,
    ...(ctx.ui ? { tela: ctx.ui } : {}),
  };
}
