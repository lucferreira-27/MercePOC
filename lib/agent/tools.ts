import { z } from 'zod';
import { generateComposition, layout, openAllGroups, openingLimit, type ModularPart } from '../composition';
import { planDataUrl } from '../plan-render';
import { sceneDrawingParts } from '../scene-parts';
import { cutPlan } from '../cutplan';
import { materialIds, PART_KINDS, type PartKind } from '../furniture';
import { edgeSides, mergePrices, money, quantity, quoteOf, type Prices } from '../quote';
import {
  applyObstacleEdits,
  furnitureOnWall,
  emptyRoom,
  fitReport,
  fitSummary,
  fitWallsToCeiling,
  obstacleClash,
  obstacleEditsSchema,
  roomSchema,
  type Room,
} from '../room';
import { create, createFromTemplate, fork, list, redo, seek, undo } from '../store';
import {
  canonical,
  describeDesignChanges,
  describeHighlights,
  entityIds,
  executeRequest,
  generateDesign,
  opSchema,
  selectedPartIds,
  type Design,
  type ShelfOp,
} from '../studio';
import { templates } from '../templates';
import { normalizeSuggestions } from '../gateway';
import type { AgentContext } from './context';
import { contextSnapshot } from './snapshot';
import { planRow } from './macros';
import { askJev, noulOf, type JevAnswer, type JevQuestion } from './jev';
import { askGateOn, askVerdict, blockText } from './ask-gate';
import { designFacts, factClaims, factsLine, objectiveOf, sheetLevers } from './facts';
import { pieceSchema, placedLine, planPieces } from './place';
import { modifySchema, planModify } from './modify';
import { sceneOf } from './scene';
import { EXPORT_KINDS, UI_TABS, VIEW_MODES, type OptionCard, type Tool, type ToolResult } from './types';

/** Inferência do tipo dos argumentos a partir do esquema. */
function tool<S extends z.ZodType>(t: Omit<Tool<z.infer<S>>, 'args'> & { args: S }): Tool<z.infer<S>> {
  return t as Tool<z.infer<S>>;
}
const ok = (text: string, label?: string, image?: string): ToolResult => ({ ok: true, text, label, ...(image ? { image } : {}) });
const fail = (text: string, label?: string): ToolResult => ({ ok: false, text, label });
const r1 = (v: number) => Math.round(v * 10) / 10;
const json = (v: unknown) => JSON.stringify(v);
const mm = (d: Design) => `${r1(d.width)} × ${r1(d.height)} × ${r1(d.depth)} mm`;
/** Metros com vírgula, como o resto da interface: "3,2". */
const metresLabel = (value: number) => String(Math.round(value / 10) / 100).replace('.', ',');

/** Ids que a IA pode citar depois: módulos, compartimentos e frentes. */
function namedIds(d: Design) {
  const cells = layout(canonical(d)).cells;
  return new Set([
    ...d.modules.map((m) => m.id),
    ...cells.map((c) => c.id),
    ...cells.flatMap((c) => (c.node.front ? [c.node.front.id] : [])),
  ]);
}

// ---------------------------------------------------------------- leitura
const stateRead = tool({
  name: 'state_read',
  description:
    'Lê o estado atual do rascunho: módulos, conexões, compartimentos com ids reais, frentes, ambiente e encaixe. Use depois de mudanças grandes, antes de citar ids.',
  args: z.object({}).strict(),
  running: () => 'Lendo o projeto',
  run: (ctx) => ok(json(contextSnapshot(ctx)), 'Li o projeto'),
});

const partsList = tool({
  name: 'parts_list',
  description:
    'Lista as peças de corte (id, nome, C × L × E em mm, material, bordas com fita, nº no plano de corte). Filtra por módulo, material ou tipo.',
  args: z
    .object({
      modulo: z.string().max(100).optional(),
      material: z.string().max(60).optional(),
      tipo: z.enum(PART_KINDS as [PartKind, ...PartKind[]]).optional(),
    })
    .strict(),
  running: () => 'Conferindo as peças',
  run: (ctx, a) => {
    const parts = generateDesign(ctx.design).parts as ModularPart[];
    const numbers = new Map<string, number>();
    for (const s of cutPlan(parts).sheets) for (const p of s.placements) numbers.set(p.id, p.n);
    const rows = parts
      .filter((p) => !a.modulo || p.owners.includes(a.modulo))
      .filter((p) => !a.material || p.material.toLowerCase().includes(a.material.toLowerCase()))
      .filter((p) => !a.tipo || p.kind === a.tipo)
      .map((p) => {
        const e = edgeSides(p);
        return [p.id, p.name, `${r1(p.c)}×${r1(p.l)}×${p.thickness}`, p.material, Object.entries(e).filter(([, v]) => v).map(([k]) => k).join('') || '-', numbers.get(p.id) ?? '-'].join(' | ');
      });
    const head = `${rows.length} de ${parts.length} peças. Colunas: id | nome | C×L×E mm | material | fita (c1 frente, c2 trás, l1, l2) | nº corte`;
    ctx.note('parts');
    return ok([head, ...rows.slice(0, 120)].join('\n') + (rows.length > 120 ? `\n… mais ${rows.length - 120}` : ''), 'Conferi as peças');
  },
});

const quoteRead = tool({
  name: 'quote_read',
  description: 'Lê o orçamento linha a linha (seção, item, quantidade, unitário, total), custo, margem e total, com a tabela de preços atual.',
  args: z.object({}).strict(),
  running: () => 'Calculando o orçamento',
  run: (ctx) => {
    const q = quoteOf(canonical(ctx.design), ctx.prices);
    const lines = q.lines.map((l) => `${l.section} | ${l.label} | ${quantity(l.qty)} ${l.unit} × ${money(l.unitPrice)} = ${money(l.total)}`);
    ctx.note('quote');
    return ok(
      [...lines, `Custo ${money(q.cost)} + margem ${ctx.prices.margin}% ${money(q.marginValue)} = total ${money(q.total)}`].join('\n'),
      `Calculei o orçamento: ${money(q.total)}`,
    );
  },
});

const cutplanRead = tool({
  name: 'cutplan_read',
  description:
    'Lê o plano de corte: chapas por material com aproveitamento e sobras; com `chapa` (nº de 1 em diante) devolve as peças dessa chapa com posição e medida.',
  args: z.object({ chapa: z.number().int().min(1).optional() }).strict(),
  running: () => 'Conferindo o plano de corte',
  run: (ctx, a) => {
    const plan = cutPlan(generateDesign(ctx.design).parts);
    ctx.note('cut');
    if (a.chapa) {
      const s = plan.sheets[a.chapa - 1];
      if (!s) return fail(`Não existe a chapa ${a.chapa}; o plano tem ${plan.sheets.length}.`);
      return ok(
        [`Chapa ${a.chapa}: ${s.material} ${s.thickness} mm, ${Math.round(s.efficiency * 100)}% usada`, ...s.placements.map((p) => `nº ${p.n} ${p.name} ${p.w}×${p.h} em (${r1(p.x)}, ${r1(p.y)})${p.rotated ? ' girada' : ''}`)].join('\n'),
        `Abri a chapa ${a.chapa}`,
      );
    }
    const groups = plan.groups.map((g) => `${g.material} ${g.thickness} mm: ${g.sheets} chapas, ${g.parts} peças, ${Math.round(g.efficiency * 100)}%`);
    const over = plan.oversize.length ? `\nFora da chapa: ${plan.oversize.map((o) => `${o.name} (${o.c}×${o.l})`).join(', ')}` : '';
    return ok(`${plan.sheets.length} chapas.\n${groups.join('\n')}${over}`, `Conferi o plano de corte: ${plan.sheets.length} chapas`);
  },
});

// ---------------------------------------------------------------- desenho
const designApply = tool({
  name: 'design_apply',
  description:
    'Aplica um lote de operações do contrato ao rascunho, de forma atômica. Devolve o que mudou, os ids novos e as medidas gerais; se a validação recusar, nada muda e volta o erro para corrigir.',
  args: z.object({ ops: z.array(opSchema).min(1).max(48), rotulo: z.string().max(90).optional() }).strict(),
  running: (a) => a.rotulo ?? 'Desenhando',
  run: (ctx, a) => {
    const before = ctx.design;
    const roomBefore = ctx.room;
    const r = executeRequest(before, a.ops as ShelfOp[]);
    if (!r.ok) {
      ctx.attempted.push({ ops: a.ops as ShelfOp[], error: r.error });
      // "move" das prateleiras antigas com id de módulo: o erro do motor não diz o caminho.
      const hint = /prateleira horizontal/.test(r.error) && (a.ops as ShelfOp[]).some((o) => o.kind === 'move' || o.kind === 'gap')
        ? ' move e gap servem só para prateleiras (sh-N); para mudar um módulo de lugar use modify mover.'
        : '';
      return fail(`Recusado pela validação, nada mudou: ${r.error}${hint}`, 'Proposta recusada pela validação; corrigindo');
    }
    if (JSON.stringify(r.design) === JSON.stringify(before)) return ok('Sem efeito: o projeto já estava assim.', 'Nada a mudar');
    ctx.setDesign(r.design, a.ops as ShelfOp[]);
    const changes = describeDesignChanges(before, r.design);
    const fit = fitNote(ctx, before, r.design, roomBefore) + sheetNote(ctx, before, r.design);
    const had = namedIds(before);
    const fresh = [...namedIds(r.design)].filter((id) => !had.has(id));
    const titles = describeHighlights(before, r.design, a.ops as ShelfOp[]).map((h) => h.title);
    return ok(
      `Aplicado no rascunho. ${changes.join('. ')}. Medidas gerais: ${mm(r.design)}.${fresh.length ? ` Ids novos: ${fresh.slice(0, 40).join(', ')}.` : ''}${fit}`,
      a.rotulo ?? (titles.slice(0, 3).join(', ') || 'Editei o móvel'),
    );
  },
});

const rowBuild = tool({
  name: 'row_build',
  description:
    'Monta uma fileira de módulos ao longo da parede, com a conta feita pelo app: divide o vão em módulos de até 90 cm (ou `modulos`), liga com painel compartilhado, encosta na parede e, com desviar_obstaculos, parte a fileira em volta de janela, porta, coluna e dos móveis que já estão na parede, na faixa de altura dela (não precisa calcular onde o móvel atual termina). Use para balcões (base 0), aéreos (base ~1500) e colunas. inicio é mm a partir do canto esquerdo da parede (sem ambiente: do lado esquerdo do móvel atual). substituir troca o móvel inteiro pela fileira.',
  args: z
    .object({
      inicio: z.number().min(-5000).max(12000),
      largura: z.number().min(200).max(12000),
      altura: z.number().min(200).max(2400),
      profundidade: z.number().min(200).max(800),
      base: z.number().min(0).max(2600).default(0),
      tipo: z.enum(['niche', 'shelf', 'drawers', 'rack']).default('niche'),
      nome: z.string().trim().min(1).max(40),
      modulos: z.number().int().min(1).max(12).optional(),
      largura_max_modulo: z.number().min(200).max(1200).optional(),
      frente: z.enum(['single', 'double', 'drawers', 'none']).optional(),
      gavetas: z.number().int().min(1).max(6).optional(),
      material: z.enum(materialIds).optional(),
      material_frente: z.enum(materialIds).optional(),
      pes: z.number().min(0).max(300).optional(),
      desviar_obstaculos: z.boolean().default(true),
      folga: z.number().min(0).max(500).default(50),
      substituir: z.boolean().default(false),
    })
    .strict(),
  running: (a) => `Montando ${a.nome.toLowerCase()}`,
  run: (ctx, a) => {
    const plan = planRow(ctx.design, ctx.room, {
      fromMm: a.inicio,
      widthMm: a.largura,
      height: a.altura,
      depth: a.profundidade,
      baseY: a.base,
      preset: a.tipo,
      name: a.nome,
      modules: a.modulos,
      maxModule: a.largura_max_modulo,
      front: a.frente,
      drawers: a.gavetas,
      materialId: a.material,
      frontMaterialId: a.material_frente,
      feet: a.pes,
      avoid: a.desviar_obstaculos,
      clearance: a.folga,
      replace: a.substituir,
    });
    const gone = plan.skipped.map((v) => `${Math.round(v.from)}–${Math.round(v.to)} mm (${v.why})`);
    if (!plan.ops.length) {
      // Sem os trechos livres a IA mudava a janela de lugar ou chutava outro início.
      const free = plan.free.map((v) => `${v.from}–${v.to} mm`);
      return fail(
        `Nada coube: ${gone.join('; ') || 'vão vazio'}.${free.length ? ` Livre nessa altura: ${free.join(', ')}. Use inicio e largura dentro de um desses trechos, ou pule esta fileira e diga por quê.` : ' Não há trecho livre nessa altura: pule esta fileira e diga por quê.'}`,
        'Nada coube nesse trecho da parede',
      );
    }
    // A parede fica presa onde está: módulos novos à esquerda ou a troca do
    // móvel não podem arrastar a parede junto.
    const room = plan.anchor && ctx.room ? { ...ctx.room, anchor: plan.anchor } : ctx.room;
    const before = ctx.design;
    const r = executeRequest(before, plan.ops);
    if (!r.ok) {
      ctx.attempted.push({ ops: plan.ops, error: r.error });
      return fail(`Recusado pela validação, nada mudou: ${r.error}`, 'Fileira recusada; ajustando');
    }
    ctx.setDesign(r.design, plan.ops, room);
    const parts = plan.segments.map((v) => `${v.from}–${v.to} mm: ${v.ids.join(', ')} (compartimentos ${v.ids.map((id) => `${id}:root`).join(', ')})`);
    const count = plan.segments.reduce((n, v) => n + v.ids.length, 0);
    // A IA repetia a largura pedida na resposta ("bancada de 2 m") quando só
    // parte coube: o resultado diz a largura montada, com todas as letras.
    const built = plan.segments.reduce((n, v) => n + v.to - v.from, 0);
    const short = built < a.largura - 1 ? ` Montado: ${built} mm dos ${a.largura} mm pedidos (o resto não coube). Na resposta, diga ${built} mm, não ${a.largura} mm.` : '';
    const fronts = a.frente && a.frente !== 'none' ? `Frentes: ${a.frente === 'drawers' ? `${a.gavetas ?? 3} gavetas` : a.frente === 'double' ? 'porta dupla' : 'porta simples'} em cada módulo.` : 'Sem frentes: para pôr, front.set em cada "<id>:root".';
    return ok(
      `Fileira "${a.nome}" montada no lugar certo (encostada na parede, fora dos obstáculos): não mova nem refaça. ${parts.join('; ')}. ${fronts}${gone.length ? ` Pulado: ${gone.join('; ')}.` : ''}${short} Medidas gerais: ${mm(r.design)}.${room ? ` ${fitSummary(r.design, room)}.` : ''}`,
      `${a.nome}: ${count} ${count === 1 ? 'módulo' : 'módulos'}${gone.length ? `, desviando de ${plan.skipped.map((v) => v.why).join(', ')}` : ''}`,
    );
  },
});

/**
 * Aplica operações montadas pelo app (peças novas, edições) com a parede
 * presa e o ambiente novo, e devolve o que mudou com o encaixe e as chapas.
 */
function applyPlanned(ctx: AgentContext, ops: ShelfOp[], room: Room | undefined, head: string, label: string, failLabel: string) {
  const before = ctx.design;
  const roomBefore = ctx.room;
  const r = executeRequest(before, ops);
  if (!r.ok) {
    ctx.attempted.push({ ops, error: r.error });
    return fail(`Recusado pela validação, nada mudou: ${r.error}`, failLabel);
  }
  if (room !== ctx.room) ctx.setRoom(room);
  ctx.setDesign(r.design, ops);
  const changes = describeDesignChanges(before, r.design);
  const had = namedIds(before);
  const fresh = [...namedIds(r.design)].filter((id) => !had.has(id));
  return ok(
    `${head} ${changes.length ? `${changes.join('. ')}. ` : ''}Medidas gerais: ${mm(r.design)}.${fresh.length ? ` Ids novos: ${fresh.slice(0, 40).join(', ')}.` : ''}${fitNote(ctx, before, r.design, roomBefore)}${sheetNote(ctx, before, r.design)}`,
    label,
  );
}

/** Parede presa antes de mexer: sem âncora ela acompanharia o lado esquerdo do móvel. */
function pinnedRoom(ctx: AgentContext) {
  const anchor = ctx.room ? sceneOf(ctx.design, ctx.room).anchor : null;
  return anchor && ctx.room ? { ...ctx.room, anchor } : ctx.room;
}

const placeTool = tool({
  name: 'place',
  description:
    'Põe peças novas pela relação, sem calcular posição: ao lado, acima ou abaixo de um módulo, de um obstáculo (TV, janela, porta) ou de outra peça do lote, ou num x/y da parede. O app acha a superfície (painel de parede ou parede), a profundidade, o interior e confere encaixe, TV e obstáculos antes de montar. Medida dita é exata (se não cabe, volta o conflito com o espaço livre); medida ausente vem do tipo e da referência e encolhe até o espaço. tipo vao reserva espaço livre no piso (máquina de lavar, geladeira) que nenhuma peça ocupa.',
  args: z
    .object({
      pecas: z.array(pieceSchema).min(1).max(8),
      substituir: z.boolean().default(false).describe('Troca o móvel inteiro por estas peças (projeto_inicial ou pedido de troca)'),
      rotulo: z.string().max(90).optional(),
    })
    .strict(),
  running: (a) => a.rotulo ?? (a.pecas.length === 1 ? `Pondo ${a.pecas[0].nome.toLowerCase()}` : `Pondo ${a.pecas.length} peças`),
  run: (ctx, a) => {
    if (a.pecas.some((p) => p.tipo === 'vao') && !ctx.room)
      return fail('Vão reservado mede na parede: meça o ambiente antes (room_set).', 'Falta o ambiente');
    const plan = planPieces(ctx.design, ctx.room, a.pecas, a.substituir);
    if ('error' in plan) {
      ctx.attempted.push({ ops: [], error: plan.error ?? '' });
      return fail(`Nada foi montado: ${plan.error}`, 'Peça não coube; ajustando');
    }
    let room = pinnedRoom(ctx);
    if (plan.reserved.length && room) {
      const taken = new Set((room.obstacles ?? []).map((o) => o.id));
      // O id do vão é a ref que a IA deu: ela usa como referência nas próximas chamadas.
      const add = plan.reserved.map((v) => {
        let id = v.ref;
        for (let k = 2; taken.has(id); k++) id = `${v.ref}-${k}`;
        taken.add(id);
        return { id, kind: 'other' as const, label: v.label, xMm: Math.round(v.x0), yMm: Math.round(v.y0), widthMm: Math.round(v.x1 - v.x0), heightMm: Math.round(v.y1 - v.y0) };
      });
      room = { ...room, obstacles: [...(room.obstacles ?? []), ...add] };
    }
    const count = plan.placed.filter((p) => p.cells.length || p.surface !== 'piso').length;
    return applyPlanned(
      ctx,
      plan.ops,
      room,
      `Montado no rascunho (não mova nem refaça o que coube): ${plan.placed.map(placedLine).join('; ')}.`,
      a.rotulo ?? (count === 1 ? `Pus ${plan.placed[0].name.toLowerCase()}` : `Pus ${plan.placed.length} peças`),
      'Peça recusada; ajustando',
    );
  },
});

const modifyTool = tool({
  name: 'modify',
  description:
    'Edita módulos que já existem, com a contabilidade do app: remover (as conexões saem junto e os vizinhos ficam no lugar), mover (para um lugar dito como no place; sem de, só encosta o fundo na parede ou muda x/y), medidas (altura, altura_total com pés, profundidade e pés valem para a fileira de painel compartilhado inteira; largura mantém a borda escolhida) e interior (troca frentes e divisões do módulo inteiro). Tudo num lote atômico.',
  args: modifySchema,
  running: (a) => a.rotulo ?? 'Ajustando os módulos',
  run: (ctx, a) => {
    // Tirar tudo para montar outro móvel: a IA ficava presa em "mantenha ao
    // menos um módulo" e o pedido acabava sem nada montado.
    if (a.remover?.length && ctx.design.modules.every((m) => a.remover!.includes(m.id)))
      return fail(
        'Nada mudou: o projeto não fica sem módulo. Para trocar o móvel inteiro, monte o novo com place (ou row_build) e substituir:true, que tira o atual no mesmo lote.',
        'Troca do móvel; ajustando',
      );
    const plan = planModify(ctx.design, ctx.room, a);
    // Tudo já estava como pedido: sem efeito, como no design_apply.
    if (!('error' in plan) && !plan.ops.length) return ok(`Sem efeito: ${plan.lines.join(' ')}`, 'Nada a mudar');
    if ('error' in plan) {
      ctx.attempted.push({ ops: [], error: plan.error });
      return fail(`Nada mudou: ${plan.error}`, 'Edição não coube; ajustando');
    }
    return applyPlanned(ctx, plan.ops, pinnedRoom(ctx), `Feito no rascunho: ${plan.lines.join(' ')}`, a.rotulo ?? 'Ajustei os módulos', 'Edição recusada; ajustando');
  },
});

// ---------------------------------------------------------------- ambiente
const roomSet = tool({
  name: 'room_set',
  description: 'Define as medidas da parede do ambiente em mm (largura, altura/pé-direito, profundidade do cômodo, rodapé). Cria o ambiente se não houver.',
  args: z
    .object({
      largura: z.number().optional(),
      altura: z.number().optional(),
      profundidade: z.number().optional(),
      rodape: z.number().optional(),
    })
    .strict(),
  running: () => 'Medindo a parede',
  run: (ctx, a) => {
    // Ambiente sem schemaVersion (projeto antigo, cena de teste) não pode travar a medida da parede.
    const base: Room = { ...(ctx.room ?? emptyRoom()), schemaVersion: 1 };
    const next = {
      ...base,
      ...(a.largura !== undefined ? { widthMm: a.largura } : {}),
      ...(a.altura !== undefined ? { heightMm: a.altura } : {}),
      ...(a.profundidade !== undefined ? { depthMm: a.profundidade } : {}),
      ...(a.rodape !== undefined ? { baseboardMm: a.rodape } : {}),
      // Paredes na altura do teto acompanham o pé-direito novo.
      ...(a.altura !== undefined && base.walls?.length ? { walls: fitWallsToCeiling(base.walls, base.heightMm, a.altura) } : {}),
    };
    const parsed = roomSchema.safeParse(next);
    if (!parsed.success) return fail(`Medida fora do limite do ambiente: ${parsed.error.issues.map((i) => `${i.path.join('.')} ${i.message}`).join('; ')}`);
    ctx.setRoom(parsed.data);
    return ok(`Parede ${parsed.data.widthMm} × ${parsed.data.heightMm} mm. ${fitSummary(ctx.design, parsed.data)}.`, `Parede de ${metresLabel(parsed.data.widthMm)} × ${metresLabel(parsed.data.heightMm)} m`);
  },
});

const roomObstacles = tool({
  name: 'room_obstacles',
  description:
    'Põe, move ou tira porta, janela, tomada, coluna, TV ou outro obstáculo da parede (mm, x do canto esquerdo, y do piso). Sem medida dita: porta 800×2100 no piso, janela 1200×1000 a 1000 do piso, tomada 80×80 a 300, TV 55" 1230×710 com centro a 1300, coluna 300 × pé-direito.',
  args: obstacleEditsSchema,
  running: () => 'Marcando a parede',
  run: (ctx, a) => {
    const had = new Set((ctx.room?.obstacles ?? []).map((o) => o.id));
    // Janela e porta não vão para trás do móvel: o app acha o lugar livre.
    // A estante de partida, ainda sem nada montado no pedido, vai sair: com
    // ela contando, a porta da foto era empurrada ou recusada e a IA gastava o
    // pedido redesenhando a parede.
    const replaced = ctx.starting && !ctx.designChanged;
    const edited = applyObstacleEdits(ctx.room, a, ctx.design.width, ctx.room && !replaced ? furnitureOnWall(canonical(ctx.design), ctx.room) : []);
    const clash = obstacleClash(edited.room.obstacles ?? []);
    if (clash) return fail(clash);
    ctx.setRoom(edited.room);
    const fresh = (edited.room.obstacles ?? []).filter((o) => !had.has(o.id)).map((o) => `${o.id} (${o.kind})`);
    return ok(
      `${fresh.length ? `Novos: ${fresh.join(', ')}. ` : ''}${edited.moved.length ? `Ajustei para um lugar livre: ${edited.moved.join('; ')}. ` : ''}${edited.skipped.length ? `Não coube: ${edited.skipped.join(', ')}. ` : ''}${replaced ? 'A estante de partida sai quando você montar o móvel novo (place ou row_build com substituir:true)' : fitSummary(ctx.design, edited.room)}.${edited.skipped.length ? ' Para o que não coube: use uma medida que caiba num trecho livre, ou siga sem ele.' : ''} A parede está marcada: siga para os móveis.`,
      edited.skipped.length ? 'Parte dos obstáculos não coube na parede' : 'Marquei a parede',
    );
  },
});

// ---------------------------------------------------------------- visão e interface
const viewCamera = tool({
  name: 'view_camera',
  description: 'Muda a vista da cena: perspectiva, frente, lado ou topo. Use para mostrar o que mudou ou o que foi pedido.',
  args: z.object({ vista: z.enum(VIEW_MODES) }).strict(),
  run: (ctx, a) => {
    ctx.effect({ type: 'camera', mode: a.vista });
    return ok('Vista trocada.', { perspective: 'Vista em perspectiva', front: 'Vista de frente', side: 'Vista de lado', top: 'Vista de cima' }[a.vista]);
  },
});
const viewFrame = tool({
  name: 'view_frame',
  description: 'Enquadra o móvel inteiro na cena.',
  args: z.object({}).strict(),
  run: (ctx) => {
    ctx.effect({ type: 'frame' });
    return ok('Enquadrado.', 'Enquadrei o móvel');
  },
});
const viewToggle = tool({
  name: 'view_toggle',
  description: 'Liga ou desliga na cena: explode (peças afastadas), dims (cotas) ou room (parede e ambiente).',
  args: z.object({ o_que: z.enum(['explode', 'dims', 'room']), ligado: z.boolean() }).strict(),
  run: (ctx, a) => {
    ctx.effect({ type: 'toggle', what: a.o_que, on: a.ligado });
    const what = { explode: 'vista explodida', dims: 'cotas', room: 'parede' }[a.o_que];
    return ok('Feito.', `${a.ligado ? 'Mostrei' : 'Escondi'} ${what}`);
  },
});
const frontsOpen = tool({
  name: 'fronts_open',
  description:
    'Abre ou fecha portas e gavetas na cena (sem mudar o projeto). ids de módulo, compartimento ou frente; lista vazia vale para todas. Diz quais batem em outra peça.',
  args: z.object({ ids: z.array(z.string().max(100)).max(200).default([]), abrir: z.boolean() }).strict(),
  run: (ctx, a) => {
    const parts = generateDesign(ctx.design).parts as ModularPart[];
    const inside = a.ids.length ? new Set(selectedPartIds(ctx.design, a.ids)) : null;
    // Todas: a folha de correr de trás fica (abrir as duas só troca de lugar).
    const groups = inside ? [...new Set(parts.filter((p) => p.motion && (inside.has(p.id) || a.ids.includes(p.motion.id))).map((p) => p.motion!.id))] : openAllGroups(parts);
    if (!groups.length) return fail('Nenhuma porta ou gaveta nesses ids.');
    ctx.fronts = { ids: a.ids.length ? a.ids : groups, open: a.abrir };
    const blocked = a.abrir ? groups.filter((g) => openingLimit(parts, g) < 0.98) : [];
    return ok(
      `${groups.length} frentes ${a.abrir ? 'abertas' : 'fechadas'}.${blocked.length ? ` Batem em outra peça ao abrir: ${blocked.join(', ')}.` : ''}`,
      `${a.abrir ? 'Abri' : 'Fechei'} ${groups.length === 1 ? 'a frente' : `${groups.length} frentes`}`,
    );
  },
});
const selectTool = tool({
  name: 'select',
  description: 'Destaca módulos, compartimentos, frentes ou peças na cena, para mostrar à pessoa do que você está falando.',
  args: z.object({ ids: z.array(z.string().max(100)).min(1).max(200) }).strict(),
  run: (ctx, a) => {
    const alive = new Set(entityIds(ctx.design));
    const valid = a.ids.filter((id) => alive.has(id));
    if (!valid.length) return fail(`Nenhum desses ids existe no rascunho: ${a.ids.join(', ')}.`);
    ctx.select = valid;
    return ok(`Destacados: ${valid.join(', ')}.`, 'Destaquei no móvel');
  },
});
const uiTab = tool({
  name: 'ui_tab',
  description: 'Abre uma aba do painel lateral: project, room (ambiente), quote (orçamento), cut (plano de corte), parts (peças), history (versões).',
  args: z.object({ aba: z.enum(UI_TABS) }).strict(),
  run: (ctx, a) => {
    ctx.effect({ type: 'tab', tab: a.aba });
    return ok('Aba aberta.', `Abri ${{ project: 'Projeto', room: 'Ambiente', quote: 'Orçamento', cut: 'Corte', parts: 'Peças', history: 'Versões' }[a.aba]}`);
  },
});
const exportFile = tool({
  name: 'export_file',
  description:
    'Gera um arquivo da versão que este pedido grava: pdf (desenho, orçamento, peças e corte), png (foto da vista), parts-csv (lista de peças), cut-csv (plano de corte), cortecloud, json (projeto). Sai no fim do pedido, como download na tela da pessoa: só quando ela pediu o arquivo.',
  args: z.object({ formato: z.enum(EXPORT_KINDS) }).strict(),
  run: async (ctx, a) => {
    if (!(await fileAsked(ctx)))
      return fail('A pessoa não pediu arquivo neste pedido: não exporte por conta própria (vira um download na tela dela). Siga sem arquivo.', 'Arquivo não pedido; segui sem');
    ctx.effect({ type: 'export', kind: a.formato });
    const name = { pdf: 'o PDF', png: 'a foto da vista', 'parts-csv': 'a lista de peças', 'cut-csv': 'o plano de corte', cortecloud: 'o arquivo Cortecloud', json: 'o projeto em JSON' }[a.formato];
    return ok(`Feito: ${name} é gerado automaticamente quando este pedido terminar, a partir da versão final. Diga à pessoa que foi gerado.`, `Gerei ${name}`);
  },
});

// ---------------------------------------------------------------- preços
const pricesSet = tool({
  name: 'prices_set',
  description:
    'Muda a tabela de preços do orçamento (vale para todos os projetos neste navegador): margem em %, chapas 18 mm por materialId, fita por metro, dobradiça, corrediça (par), puxador, kit por módulo, corte por peça, montagem por módulo, regulagem por frente, fatores das chapas de 15 e 6 mm, com_puxador.',
  args: z
    .object({
      margem: z.number().min(0).max(300).optional(),
      chapas: z.partialRecord(z.enum(materialIds), z.number().min(0)).optional(),
      fita_m: z.number().min(0).optional(),
      dobradica: z.number().min(0).optional(),
      corredica_par: z.number().min(0).optional(),
      puxador: z.number().min(0).optional(),
      kit_modulo: z.number().min(0).optional(),
      corte_peca: z.number().min(0).optional(),
      montagem_modulo: z.number().min(0).optional(),
      regulagem_frente: z.number().min(0).optional(),
      fator_15: z.number().min(0).max(2).optional(),
      fator_6: z.number().min(0).max(2).optional(),
      com_puxador: z.boolean().optional(),
    })
    .strict(),
  running: () => 'Ajustando os preços',
  run: (ctx, a) => {
    const next: Prices = mergePrices({
      ...ctx.prices,
      sheets: { ...ctx.prices.sheets, ...a.chapas },
      ...(a.margem !== undefined ? { margin: a.margem } : {}),
      ...(a.fita_m !== undefined ? { edgePerM: a.fita_m } : {}),
      ...(a.dobradica !== undefined ? { hinge: a.dobradica } : {}),
      ...(a.corredica_par !== undefined ? { slidePair: a.corredica_par } : {}),
      ...(a.puxador !== undefined ? { handle: a.puxador } : {}),
      ...(a.kit_modulo !== undefined ? { moduleKit: a.kit_modulo } : {}),
      ...(a.corte_peca !== undefined ? { labourPerPart: a.corte_peca } : {}),
      ...(a.montagem_modulo !== undefined ? { labourPerModule: a.montagem_modulo } : {}),
      ...(a.regulagem_frente !== undefined ? { labourPerFront: a.regulagem_frente } : {}),
      ...(a.fator_15 !== undefined ? { factor15: a.fator_15 } : {}),
      ...(a.fator_6 !== undefined ? { factor6: a.fator_6 } : {}),
      ...(a.com_puxador !== undefined ? { handles: a.com_puxador } : {}),
    });
    ctx.prices = next;
    ctx.effect({ type: 'prices', prices: next });
    const q = quoteOf(canonical(ctx.design), next);
    return ok(`Tabela atualizada. Total agora ${money(q.total)} (custo ${money(q.cost)} + margem ${next.margin}%).`, `Ajustei os preços: total ${money(q.total)}`);
  },
});

// ---------------------------------------------------------------- versões e projetos
const historyList = tool({
  name: 'history_list',
  description: 'Lista as versões do projeto (número, rótulo, data) e qual está vigente.',
  args: z.object({}).strict(),
  run: (ctx) => {
    const p = ctx.project;
    return ok(
      p.revisions.map((r, i) => `v${i + 1}${i === p.cursor ? ' (vigente)' : ''} ${r.label} · ${new Date(r.at).toLocaleString('pt-BR')}`).join('\n'),
      'Conferi as versões',
    );
  },
});
const historyGoto = tool({
  name: 'history_goto',
  description: 'Volta (ou avança) para a versão de número `versao`. O que este pedido mudou antes é gravado primeiro.',
  args: z.object({ versao: z.number().int().min(1) }).strict(),
  run: (ctx, a) => {
    const p = ctx.project;
    if (a.versao > p.revisions.length) return fail(`O projeto tem ${p.revisions.length} versões.`);
    ctx.commit();
    seek(p, a.versao - 1);
    ctx.navigated = true;
    ctx.rebase();
    return ok(`Agora na versão ${a.versao}: ${p.revisions[p.cursor].label}. Medidas ${mm(ctx.design)}.`, `Voltei para a versão ${a.versao}`);
  },
});
const historyUndo = tool({
  name: 'history_undo',
  description:
    'Desfaz a última versão (como Ctrl+Z). Se este pedido já mudou algo, desfaz só a última mudança deste pedido (a chamada anterior que mudou o desenho); com tudo: true, descarta todas as mudanças deste pedido.',
  args: z.object({ tudo: z.boolean().optional() }).strict(),
  run: (ctx, a) => {
    if (ctx.designChanged || ctx.roomChanged) {
      // Um passo por vez: descartar o pedido inteiro jogava fora mudanças
      // boas quando a IA só queria refazer a última. As operações que saem
      // ficam como desfeitas, fora do registro do que o pedido gravou.
      if (!a.tudo && ctx.stepBack()) {
        const left = ctx.designChanged || ctx.roomChanged;
        return ok(
          `Desfiz a última mudança deste pedido. ${left ? `Ficam ${ctx.undoable} mudança(s) anteriores deste pedido; medidas agora ${mm(ctx.design)}.` : 'O rascunho voltou ao começo do pedido.'}`,
          'Desfiz a última mudança',
        );
      }
      ctx.discard();
      return ok('Descartei todas as mudanças deste pedido.', 'Descartei as mudanças');
    }
    const r = undo(ctx.project);
    if (!r) return fail('Já está na primeira versão.');
    ctx.navigated = true;
    ctx.rebase();
    return ok(`Desfeito. Agora na versão ${ctx.project.cursor + 1}.`, 'Desfiz a última mudança');
  },
});
const historyRedo = tool({
  name: 'history_redo',
  description: 'Refaz a versão desfeita (como Ctrl+Y).',
  args: z.object({}).strict(),
  run: (ctx) => {
    const r = redo(ctx.project);
    if (!r) return fail('Não há o que refazer.');
    ctx.navigated = true;
    ctx.rebase();
    return ok(`Refeito. Agora na versão ${ctx.project.cursor + 1}.`, 'Refiz a mudança');
  },
});
const projectRename = tool({
  name: 'project_rename',
  description: 'Renomeia o projeto.',
  args: z.object({ nome: z.string().trim().min(1).max(80) }).strict(),
  run: (ctx, a) => {
    ctx.project.name = a.nome;
    return ok(`Projeto agora se chama "${a.nome}".`, `Renomeei para "${a.nome}"`);
  },
});
const projectFork = tool({
  name: 'project_fork',
  description:
    'Cria uma alternativa (cópia independente) a partir da versão vigente ou de `versao`, e passa a editar a alternativa. O projeto original fica como está.',
  args: z.object({ nome: z.string().trim().min(1).max(80), versao: z.number().int().min(1).optional() }).strict(),
  running: () => 'Criando a alternativa',
  run: (ctx, a) => {
    ctx.commit();
    ctx.persist();
    const cursor = a.versao ? a.versao - 1 : ctx.project.cursor;
    const created = fork(ctx.project.id, cursor, a.nome);
    ctx.switchTo(created.id);
    return ok(`Alternativa "${a.nome}" criada e aberta. As próximas mudanças vão nela.`, `Criei a alternativa "${a.nome}"`);
  },
});
const projectNew = tool({
  name: 'project_new',
  description: `Cria um projeto novo e passa a editá-lo: em branco ou a partir de um modelo (${templates.map((t) => t.id).join(', ')}). Para trocar o móvel sem criar projeto, prefira asset.add com placement "replace".`,
  args: z.object({ modelo: z.string().max(40).optional() }).strict(),
  running: () => 'Criando o projeto',
  run: (ctx, a) => {
    if (a.modelo && !templates.some((t) => t.id === a.modelo)) return fail(`Modelo desconhecido. Use: ${templates.map((t) => t.id).join(', ')}.`);
    ctx.commit();
    ctx.persist();
    const created = a.modelo ? createFromTemplate(a.modelo) : create();
    ctx.switchTo(created.id);
    return ok(`Projeto "${created.name}" criado e aberto. ${json(contextSnapshot(ctx).medidas_gerais_mm)}`, `Criei o projeto "${created.name}"`);
  },
});
const projectList = tool({
  name: 'project_list',
  description: 'Lista os projetos salvos (id, nome, versões), do mais recente ao mais antigo.',
  args: z.object({}).strict(),
  run: () =>
    ok(
      list()
        .slice(0, 30)
        .map((p) => `${p.id} | ${p.name} | ${p.revisions} versões`)
        .join('\n'),
      'Conferi os projetos',
    ),
});
const projectOpen = tool({
  name: 'project_open',
  description: 'Abre outro projeto salvo (id de project_list) e passa a editá-lo.',
  args: z.object({ id: z.uuid() }).strict(),
  run: (ctx, a) => {
    if (!list().some((p) => p.id === a.id)) return fail('Projeto não encontrado.');
    ctx.commit();
    ctx.persist();
    ctx.switchTo(a.id);
    return ok(`Projeto "${ctx.project.name}" aberto.`, `Abri "${ctx.project.name}"`);
  },
});

// ---------------------------------------------------------------- conversa
const planTool = tool({
  name: 'plan',
  description: 'Para trabalho grande (várias etapas), anuncia o plano em passos curtos antes de começar. A pessoa acompanha a lista.',
  args: z.object({ passos: z.array(z.string().trim().min(2).max(80)).min(2).max(8) }).strict(),
  run: (ctx, a) => {
    ctx.plan = a.passos;
    ctx.emit({ type: 'plan', steps: a.passos });
    return ok('Plano anunciado. Siga os passos.', 'Planejei o trabalho');
  },
});
const askUser = tool({
  name: 'ask_user',
  description:
    'Pergunta à pessoa quando o pedido é realmente ambíguo (alvo ou eixo de medida incerto) e errar custaria caro. Termina o pedido. Opções com rótulo curto e, se couber, os ids do alvo.',
  args: z
    .object({
      pergunta: z.string().trim().min(3).max(300),
      opcoes: z
        .array(z.object({ rotulo: z.string().trim().min(1).max(80), ids: z.array(z.string().max(100)).max(8).default([]) }).strict())
        .min(2)
        .max(6),
    })
    .strict(),
  run: async (ctx, a) => {
    // Perguntar ou fazer: pergunta com padrão ou limite volta para a IA
    // fazer. Uma vez por pedido: se ela insistir, a pergunta segue.
    if (!ctx.askGated && askGateOn()) {
      ctx.askGated = true;
      const verdict = await askVerdict(a.pergunta, { pedido: ctx.request, selected: ctx.selected.length > 0, shelves: ctx.design.shelves.length });
      if (verdict && !verdict.legit) return fail(blockText(verdict), 'Segui sem perguntar');
    }
    const alive = new Set(entityIds(ctx.design));
    ctx.ask = {
      question: a.pergunta,
      options: a.opcoes.map((o, i) => ({ id: `o${i + 1}`, label: o.rotulo, partIds: o.ids.filter((id) => alive.has(id)) })),
    };
    return ok('Pergunta enviada.', 'Perguntei');
  },
});
const finishTool = tool({
  name: 'finish',
  description:
    'Termina o pedido com a resposta à pessoa (1 a 3 frases, pt-BR, sem ids internos, só o que as ferramentas fizeram) e 2 ou 3 sugestões de próximo passo. O app confere o trabalho antes: se voltar um problema, corrija e chame finish de novo.',
  args: z
    .object({
      // Resposta longa é onde a IA soma totais de cabeça e erra: as do bench
      // ficam abaixo de 700 caracteres (mediana 267).
      mensagem: z.string().trim().min(1).max(700, 'Mensagem longa demais: 1 a 3 frases (até 700 caracteres), só o que mudou, sem somar totais de cabeça. Chame finish de novo.'),
      sugestoes: z.array(z.string().max(80)).max(4).default([]),
    })
    .strict(),
  run: async (ctx, a) => {
    const issues = checkWork(ctx);
    // Números da resposta contra o estado que fica (não contra a última leitura).
    // Com opções montadas, a resposta compara os cartões (números do app, do
    // options_make) e o projeto não muda: essas duas conferências não valem.
    const options = !!ctx.options?.length;
    const wrong = options ? [] : factClaims(a.mensagem, designFacts(ctx.design, ctx.prices), designFacts(ctx.turnStart.design, ctx.prices));
    if (wrong.length)
      issues.push(
        `A mensagem ${wrong.join('; ')}. Fatos do estado final: ${factsLine(designFacts(ctx.design, ctx.prices))}. Reescreva só com esses números.`,
      );
    // Conferência visual só vale para o rascunho que ficou: desenho olhado
    // antes da última mudança é evidência velha. E o desenho do render_look
    // vai só para a IA; a pessoa vê a cena 3D, não uma imagem na conversa.
    if (LOOKED.test(a.mensagem) && !ctx.fresh('look'))
      issues.push(
        ctx.evidence.look
          ? 'A mensagem diz que conferiu o desenho, mas o móvel mudou depois do último render_look. Chame render_look de novo ou tire isso da resposta.'
          : 'A mensagem diz que conferiu o desenho, mas render_look não foi chamado. Chame render_look ou tire isso da resposta.',
      );
    if (SHOWN.test(a.mensagem))
      issues.push('A mensagem diz que um desenho foi exibido para a pessoa, mas o desenho do render_look vai só para você: a pessoa vê a cena 3D. Reescreva sem isso.');
    // Afirma que mudou o móvel e nada mudou: a peça foi recusada e a resposta
    // contava a composição como feita. Sem Jev, esta é a conferência que fica.
    if (!ctx.navigated && !ctx.origin && !ctx.designChanged && !ctx.roomChanged && JSON.stringify(ctx.design) === JSON.stringify(ctx.turnStart.design) && claimsChange(a.mensagem))
      issues.push('A mensagem diz que mudou o móvel, mas nada mudou neste pedido (as peças foram recusadas ou não foram montadas). Monte de novo com o que o erro indicou, ou diga que não deu e por quê.');
    // Objetivo mensurável (menos chapas, menor custo): conferido no estado
    // final, com as alavancas, em vez de aceitar a ação feita como prova.
    const goal = options ? null : objectiveOf(ctx.request);
    if (goal) {
      const b = designFacts(ctx.turnStart.design, ctx.prices),
        n = designFacts(ctx.design, ctx.prices);
      if (goal === 'sheets' && n.sheets >= b.sheets)
        issues.push(`O pedido quer menos chapas e o plano segue com ${n.sheets} (antes do pedido, ${b.sheets}). ${sheetLevers(ctx.design)} Mude o que for preciso, ou diga na resposta por que não dá.`);
      if (goal === 'cost' && n.total >= b.total - 0.005)
        issues.push(`O pedido quer custo menor e o total segue ${money(n.total)} (antes do pedido, ${money(b.total)}). ${sheetLevers(ctx.design)} Mude o que for preciso, ou diga na resposta por que não dá.`);
    }
    // Módulo que existia e saiu precisa estar na resposta: sumir calado era
    // o jeito de "caber" (o painel da TV trocado por uma estante).
    // Conta como dito quando a resposta fala em tirar/trocar ou cita o módulo pelo nome.
    // O projeto de partida (a estante que ninguém pediu) sai sem precisar de
    // aviso: exigir a frase custava uma volta inteira em todo móvel novo.
    const gone = ctx.navigated || ctx.origin || ctx.starting ? [] : ctx.turnStart.design.modules.filter((m) => !ctx.design.modules.some((v) => v.id === m.id));
    const told = (m: { name: string }) => a.mensagem.toLowerCase().includes(m.name.toLowerCase().split(' ')[0]);
    if (gone.length && !/\b(tir|remov|substitu|troq|troc|no lugar|sa[ií]|exclu|apag|refiz)/i.test(a.mensagem) && !gone.every(told))
      issues.push(`A mensagem não diz que saiu ${gone.filter((m) => !told(m)).map((m) => m.name).join(', ')}. Diga na resposta que saiu (e por quê).`);
    if (!issues.length && ctx.repairs < 2) {
      const [gaps, missing] = await Promise.all([claimsMatch(ctx, a.mensagem), requestMissing(ctx)]);
      if (missing?.length) issues.push(`O pedido ${missing.join('; ')}. Faça o que falta, ou diga na mensagem por que não deu.`);
      if (gaps?.length)
        issues.push(`A mensagem ${gaps.join('; ')}. Faça o que falta ou reescreva a mensagem só com o que foi feito.`);
    }
    if (issues.length && ctx.repairs < 2) {
      ctx.repairs++;
      return fail(
        `Conferência antes de terminar: ${issues.join(' ')} Corrija com as ferramentas e chame finish de novo; se não der, chame finish dizendo o problema na mensagem.`,
        'Conferi o trabalho: achei um problema, corrigindo',
      );
    }
    ctx.checked = true;
    ctx.finish = {
      message: issues.length ? `${a.mensagem}\n\nAtenção: ${issues.join(' ')}` : a.mensagem,
      suggestions: normalizeSuggestions(a.sugestoes),
    };
    return ok('Resposta enviada.', issues.length ? 'Terminei com um aviso' : 'Conferi o trabalho');
  },
});

/**
 * Encaixe depois de uma mudança, para a IA ver na hora se piorou: sem isso
 * ela movia módulos "para alinhar" e só descobria na conferência final.
 */
function fitNote(ctx: AgentContext, before: Design, after: Design, roomBefore = ctx.room) {
  const room = ctx.room;
  if (!room) return '';
  const was = new Set((roomBefore ? fitReport(before, roomBefore).issues : []).map(issueKey));
  const now = fitReport(after, room).issues;
  const worse = now.filter((i) => !was.has(issueKey(i)));
  if (worse.length) return ` ATENÇÃO, esta mudança piorou o encaixe: ${worse.map((i) => i.message).join('; ')}. Desfaça ou corrija.`;
  return ` ${fitSummary(after, room)}.`;
}

/** A resposta diz que olhou o próprio desenho ("conferi o desenho", "revisei visualmente"). */
const LOOKED = /(conferi|olhei|revisei|verifiquei|chequei)[^.]{0,30}(desenho|visualmente|visualização|imagem)|(desenho|composição)[^.]{0,20}(foi |ficou )?(conferid|revisad|verificad)|conferid[oa] visualmente/i;
/** A resposta diz que um desenho ou imagem foi mostrado à pessoa (só a IA recebe o do render_look). */
const SHOWN = /(desenho|imagem)[^.]{0,40}(exibid|mostrad|apresentad)[^.]{0,30}(para (você|voce|a pessoa)|para conferência|na conversa|aqui)/i;

/** Verbos de quem mudou o móvel, na primeira pessoa, fora de negação ("não coloquei"). */
const CHANGE_VERBS = /(montei|adicionei|acrescentei|coloquei|criei|pus|instalei|removi|tirei|troquei|mudei|ajustei|aumentei|diminuí|diminui|reduzi|passei|substituí|substitui|dividi|reorganizei|alinhei|encostei|movi|unifiquei)/i;
/** Frase sobre tela, arquivo, preço ou versão: "mudei a vista" não é mudar o móvel. */
const NOT_FURNITURE = /(vista|câmera|camera|\baba\b|cotas|enquadr|arquivo|pdf|csv|png|json|orçamento|orcamento|preço|preco|margem|nome do projeto|renome|versão|versao|parede|ambiente|explodid)/i;
function claimsChange(text: string) {
  return text.split(/(?<=[.!?;])\s+/).some((s) => CHANGE_VERBS.test(s) && !NOT_FURNITURE.test(s) && !/(?:^|[\s,;(])(não|nao|nem|sem)\s[^.]{0,20}(montei|adicionei|acrescentei|coloquei|criei|pus|instalei|removi|tirei|troquei|mudei|ajustei|aumentei|diminu|reduzi|passei|substitu|dividi|reorganizei|alinhei|encostei|movi|unifiquei)/i.test(s));
}

/** Quem causa o problema de encaixe: o mesmo problema antes e depois tem a mesma chave. */
const issueKey = (i: { code: string; key?: string }) => i.key ?? i.code;

/**
 * Chapas depois de uma mudança, quando o plano de corte mudou: material e
 * espessura decidem as chapas, e a IA trocava a cor achando que reduzia.
 */
function sheetNote(ctx: AgentContext, before: Design, after: Design) {
  const a = designFacts(before, ctx.prices),
    b = designFacts(after, ctx.prices);
  if (JSON.stringify(a.groups) === JSON.stringify(b.groups)) return '';
  return ` Plano de corte agora: ${factsLine(b)} (antes: ${a.sheets}).`;
}

/** O que o pedido fez de fato, para conferir as ações que a resposta afirma. */
export type ClaimEvidence = {
  /** Ferramentas que deram certo neste pedido. */
  tools: Set<string>;
  /** `describeDesignChanges` do começo do pedido até agora. */
  changes: string[];
  /** Vista da tela quando o pedido chegou. */
  view: string | null;
  /** Designs no fim do pedido (o rascunho e as opções montadas), para conferir o que o pedido quer ver neles. */
  designs?: Design[];
};

const VIEW_TOOLS = ['view_camera', 'view_frame', 'view_toggle', 'ui_tab'];
const NAV_TOOLS = ['history_goto', 'history_undo', 'history_redo', 'project_fork', 'project_new', 'project_open'];

/**
 * Ações que a resposta pode afirmar. O Jev só lê a resposta e diz, uma
 * pergunta por ação, se ela afirma aquilo; o código confere com as
 * ferramentas. Comparar a resposta com a lista de etapas (uma pergunta só)
 * barrava resposta certa que citava detalhes (medidas, gavetas, cor), porque
 * a lista não tem detalhes. Parede e preço ficaram de fora: "aumentei a
 * largura" soava como parede e "o orçamento subiu" como preço.
 * Calibrado em `bench/claims-cases.mjs`.
 */
export const CLAIMS = {
  arquivo: {
    q: 'afirma que gerou, baixou ou imprimiu um arquivo (PDF, CSV, imagem, JSON)?',
    min: 0.8,
    done: (e: ClaimEvidence) => e.tools.has('export_file'),
    fix: 'diz que gerou um arquivo, mas nenhum foi exportado',
  },
  vista: {
    q: 'diz que a tela está mostrando o móvel de frente, de lado, de cima ou em perspectiva?',
    min: 0.6,
    done: (e: ClaimEvidence) => VIEW_TOOLS.some((t) => e.tools.has(t)) || (!!e.view && e.view !== 'perspective'),
    fix: 'fala da vista, mas a vista não foi mudada',
  },
  abrir: {
    q: 'afirma que abriu ou fechou portas ou gavetas para mostrar?',
    min: 0.8,
    done: (e: ClaimEvidence) => e.tools.has('fronts_open'),
    fix: 'diz que abriu ou fechou frentes, mas nenhuma foi aberta ou fechada',
  },
  renomear: {
    q: 'afirma que renomeou o projeto?',
    min: 0.8,
    done: (e: ClaimEvidence) => ['project_rename', 'project_fork', 'project_new'].some((t) => e.tools.has(t)),
    fix: 'diz que renomeou o projeto, mas o nome não mudou',
  },
  versao: {
    q: 'afirma que voltou para outra versão, desfez ou refez?',
    min: 0.8,
    done: (e: ClaimEvidence) => NAV_TOOLS.some((t) => e.tools.has(t)),
    fix: 'diz que mudou de versão, mas a versão não mudou',
  },
  movel: {
    q: 'afirma que mudou o móvel (montou, adicionou, removeu, trocou material, mudou medidas, portas ou gavetas)?',
    min: 0.8,
    done: (e: ClaimEvidence) => e.changes.length > 0 || NAV_TOOLS.some((t) => e.tools.has(t)),
    fix: 'diz que mudou o móvel, mas o móvel está igual',
  },
  material: {
    q: 'afirma que trocou o material ou a cor de um móvel que já existia?',
    min: 0.6,
    done: (e: ClaimEvidence) => e.changes.some((c) => /: material |compartimentos e frentes/.test(c)) || NAV_TOOLS.some((t) => e.tools.has(t)),
    fix: 'diz que trocou material ou cor, mas nenhum material mudou',
  },
} as const;

/**
 * O que o pedido quer e o código consegue conferir no fim: o Jev lê só o
 * pedido (uma pergunta por item) e o código olha ferramentas e design.
 * Pega o trabalho pela metade que a conferência da resposta deixa passar
 * ("balcões e aéreos" com só os balcões). "Tira os aéreos" dá ~0,06 em
 * `aereos`: a pergunta é sobre o móvel ter, não sobre citar.
 */
export const WANTS = {
  arquivo: {
    q: 'pede para gerar, baixar, imprimir ou mandar um arquivo (PDF, CSV, imagem)?',
    done: CLAIMS.arquivo.done,
    fix: 'pede um arquivo e nenhum foi exportado',
  },
  vista: {
    q: 'pede para ver ou mostrar o móvel de frente, de lado, de cima ou em perspectiva?',
    done: CLAIMS.vista.done,
    fix: 'pede uma vista e a vista não foi mudada',
  },
  abrir: {
    q: 'pede para abrir ou fechar as portas ou gavetas para ver o móvel?',
    // Sem nenhuma frente não há o que abrir: a resposta explica, sem reparo.
    done: (e: ClaimEvidence) =>
      CLAIMS.abrir.done(e) || (!!e.designs && !e.designs.some((d) => generateDesign(d).parts.some((p) => p.kind === 'door' || p.kind === 'drawer'))),
    fix: 'pede para abrir ou fechar frentes e nenhuma foi aberta ou fechada',
  },
  aereos: {
    q: 'pede que o móvel tenha armários aéreos (suspensos na parede)?',
    done: (e: ClaimEvidence) => !e.designs || e.designs.some((d) => d.modules.some((m) => m.wall || (m.position?.[1] ?? 0) >= 1200)),
    fix: 'pede armários aéreos e não há nenhum módulo suspenso',
  },
  gavetas: {
    q: 'pede que o móvel tenha gavetas?',
    done: (e: ClaimEvidence) => !e.designs || e.designs.some((d) => generateDesign(d).parts.some((p) => p.kind === 'drawer')),
    fix: 'pede gavetas e o móvel não tem nenhuma',
  },
} as const;
export const WANTS_MIN = 0.7;

/** Palavras de arquivo no pedido: basta uma para o export valer. */
const FILE_WORDS = /\b(pdf|csv|png|json|cortecloud|arquivo|baix|export|imprim|planilha|download|mand[ae]|envi[ae]|plano de corte|lista de peças)/i;
/**
 * O pedido pede arquivo? Pelas palavras, ou pelo Jev (WANTS, perguntado no
 * começo do turno). Download que ninguém pediu aparecia no fim de "deixe o
 * cenário mais realista".
 */
async function fileAsked(ctx: AgentContext) {
  // O roteador só escolhe exportar quando o Jev leu um pedido de arquivo.
  if (ctx.direct || FILE_WORDS.test(ctx.request)) return true;
  const answers = await ctx.wants;
  return (noulOf(answers?.arquivo) ?? 0) >= 0.5; // barra baixa: só barra o arquivo que claramente ninguém pediu
}

export function wantQuestions(): Record<string, JevQuestion> {
  return Object.fromEntries(Object.entries(WANTS).map(([k, c]) => [k, { type: 'noul', instructions: `\`pedido\` ${c.q}` }]));
}
export function wantGaps(answers: Record<string, JevAnswer>, e: ClaimEvidence): string[] {
  return Object.entries(WANTS)
    .filter(([k, c]) => (noulOf(answers[k]) ?? 0) >= WANTS_MIN && !c.done(e))
    .map(([, c]) => c.fix);
}

export function claimQuestions(): Record<string, JevQuestion> {
  return Object.fromEntries(Object.entries(CLAIMS).map(([k, c]) => [k, { type: 'noul', instructions: `\`resposta\` ${c.q}` }]));
}

/** As ações afirmadas sem ferramenta que as prove (vazio: a resposta bate). */
export function claimGaps(answers: Record<string, JevAnswer>, e: ClaimEvidence): string[] {
  return Object.entries(CLAIMS)
    .filter(([k, c]) => (noulOf(answers[k]) ?? 0) >= c.min && !c.done(e))
    .map(([, c]) => c.fix);
}

/**
 * A resposta bate com o que foi feito? Lista o que ela afirma sem prova;
 * null quando não há Jev.
 */
function evidenceOf(ctx: AgentContext): ClaimEvidence {
  return {
    tools: new Set(ctx.steps.filter((s) => s.ok).map((s) => s.tool)),
    changes: describeDesignChanges(ctx.turnStart.design, ctx.design),
    view: ctx.ui?.view ?? null,
    designs: [ctx.design, ...(ctx.options ?? []).map((o) => o.params as Design)],
  };
}

/** O que o pedido quer e não foi feito; null sem Jev (a pergunta sai no começo do turno). */
async function requestMissing(ctx: AgentContext) {
  const answers = await ctx.wants;
  if (!answers) return null;
  return wantGaps(answers, evidenceOf(ctx));
}

async function claimsMatch(ctx: AgentContext, message: string) {
  const evidence = evidenceOf(ctx);
  const answers = await askJev({ resposta: message }, claimQuestions());
  if (process.env.MERCE_DEBUG_CLAIMS) console.error('[claims]', JSON.stringify({ resposta: message, tools: [...evidence.tools], answers }));
  return answers ? claimGaps(answers, evidence) : null;
}

/**
 * Conferência de código antes de responder: só o que este pedido piorou.
 * Encaixe no ambiente e frentes que batem ao abrir, comparados com o começo
 * do pedido, para não cobrar da IA um problema que já existia.
 */
export function checkWork(ctx: AgentContext): string[] {
  const issues: string[] = [];
  const room = ctx.room;
  const start = ctx.turnStart;
  const designMoved = JSON.stringify(ctx.design) !== JSON.stringify(start.design);
  const roomMoved = JSON.stringify(room ?? null) !== JSON.stringify(start.room ?? null);
  if (room && (designMoved || roomMoved)) {
    // Pelo causador (código, obstáculo e módulo): uma TV já tapada não
    // esconde outro módulo novo na frente dela.
    const before = new Set((start.room ? fitReport(start.design, start.room).issues : []).map(issueKey));
    for (const issue of fitReport(ctx.design, room).issues)
      if (!before.has(issueKey(issue)))
        issues.push(
          designMoved
            ? `Ambiente: ${issue.message}`
            : `Ambiente: com as medidas novas, ${issue.message.charAt(0).toLowerCase()}${issue.message.slice(1)}. Diga isso na resposta; não mude o móvel sem pedido.`,
        );
  }
  const parts = generateDesign(ctx.design).parts as ModularPart[];
  const oldParts = new Map((generateDesign(start.design).parts as ModularPart[]).map((p) => [p.id, JSON.stringify([p.size, p.position])]));
  const changedGroups = [
    ...new Set(parts.filter((p) => p.motion && oldParts.get(p.id) !== JSON.stringify([p.size, p.position])).map((p) => p.motion!.id)),
  ].slice(0, 24);
  const stuck = changedGroups.filter((g) => openingLimit(parts, g) < 0.98);
  if (stuck.length) issues.push(`Frentes que batem em outra peça ao abrir: ${stuck.join(', ')}.`);
  return issues;
}

const renderLook = tool({
  name: 'render_look',
  description:
    'Mostra para você o desenho do rascunho agora (frontal e isométrico) com a parede e o que está nela (TV em preto, janela em azul, porta), numa imagem logo depois dos resultados. Use para julgar composição, proporção e o que fica na frente do quê, antes do finish.',
  args: z.object({}).strict(),
  running: () => 'Olhando o desenho',
  run: async (ctx) => {
    ctx.note('look');
    return ok(
      'O desenho vem na próxima mensagem: o móvel com a parede em volta, como a pessoa vê a cena (TV em preto, janela em azul, porta em bege). O que está na frente cobre o que está atrás.',
      'Olhei o desenho',
      await planDataUrl(sceneDrawingParts(ctx.design, ctx.room)),
    );
  },
});

// ---------------------------------------------------------------- opções
/** Corta no fim de uma palavra, com reticências. */
const clip = (text: string, max: number) => (text.length <= max ? text : `${text.slice(0, text.lastIndexOf(' ', max)).trimEnd()}…`);
/** Números de uma opção, todos do código: a IA só dá o nome e a frase. */
export function optionCard(id: string, name: string, brief: string, design: Design, ctx: AgentContext, note: string): OptionCard {
  const q = quoteOf(canonical(design), ctx.prices);
  const b = generateComposition(canonical(design)).bounds;
  return {
    id,
    name,
    brief,
    params: design,
    total: q.total,
    sheets: q.counts.sheets,
    parts: q.counts.parts,
    doors: q.counts.doors,
    drawers: q.counts.drawers,
    size: [Math.round(b.max[0] - b.min[0]), Math.round(b.max[1] - b.min[1]), Math.round(b.max[2] - b.min[2])],
    fits: ctx.room ? fitReport(design, ctx.room).issues.length === 0 : null,
    note,
  };
}

const optionsMake = tool({
  name: 'options_make',
  description:
    'Monta 2 ou 3 opções para a pessoa comparar, sem mudar o móvel: cada variante vira um rascunho à parte (nome curto e o pedido completo daquela opção). Devolve preço, chapas, peças, frentes, medidas e encaixe de cada uma, calculados pelo app. A pessoa aplica ou salva como alternativa pelo cartão; depois chame finish comparando as opções.',
  args: z
    .object({
      variantes: z
        .array(z.object({ nome: z.string().trim().min(1).max(40), pedido: z.string().trim().min(3).max(400) }).strict())
        .min(2)
        .max(3),
    })
    .strict(),
  running: (a) => `Montando ${a.variantes.length} opções`,
  run: async (ctx, a) => {
    if (!ctx.runner) return fail('Opções não estão disponíveis aqui.');
    const made = await Promise.all(
      a.variantes.map(async (v) => {
        const sub = ctx.child();
        try {
          await ctx.runner!(sub, `Opção "${v.nome}", uma entre ${a.variantes.length} para a pessoa comparar: ${v.pedido}. Monte só esta opção no rascunho, sem perguntar e sem ler o estado de novo (ele já está acima): numa resposta só, chame design_apply ou row_build e depois finish dizendo em uma frase o que ela tem.${ctx.room ? ' Ela precisa caber no ambiente do estado (parede, janela, porta, coluna): o resultado do design_apply avisa quando o encaixe piora.' : ''}`);
        } catch (e) {
          return { v, sub, error: (e as Error).message };
        }
        return { v, sub, error: '' };
      }),
    );
    const cards: OptionCard[] = [];
    const lines: string[] = [];
    made.forEach(({ v, sub, error }, i) => {
      const letter = String.fromCharCode(65 + i);
      const changed = JSON.stringify(sub.design) !== JSON.stringify(ctx.design);
      if (error || !changed) {
        lines.push(`${letter}) ${v.nome}: não montou${error ? ` (${error.slice(0, 120)})` : ' (o rascunho ficou igual)'}.`);
        return;
      }
      const card = optionCard(`opt-${i + 1}`, v.nome, v.pedido, sub.design, ctx, clip(sub.finish?.message ?? '', 400));
      cards.push(card);
      lines.push(
        `${letter}) ${card.name}: ${money(card.total)}, ${card.sheets} chapas, ${card.parts} peças, ${card.doors} portas, ${card.drawers} gavetas, ${card.size.map((n) => r1(n / 10)).join(' × ')} cm${card.fits === null ? '' : card.fits ? ', cabe no ambiente' : ', NÃO cabe no ambiente'}. ${card.note}`,
      );
    });
    if (!cards.length) return fail(`Nenhuma opção saiu. ${lines.join(' ')}`);
    ctx.options = cards;
    return ok(
      `${lines.join('\n')}\nO móvel atual não mudou. A pessoa aplica pelo cartão; na mensagem do finish compare preço e o que cada opção tem, sem dizer que aplicou.`,
      `Montei ${cards.length} opções para comparar`,
    );
  },
});

export const TOOLS: Tool[] = [
  stateRead,
  partsList,
  quoteRead,
  cutplanRead,
  designApply,
  placeTool,
  modifyTool,
  rowBuild,
  roomSet,
  roomObstacles,
  viewCamera,
  viewFrame,
  viewToggle,
  frontsOpen,
  selectTool,
  uiTab,
  exportFile,
  pricesSet,
  historyList,
  historyGoto,
  historyUndo,
  historyRedo,
  projectRename,
  projectFork,
  projectNew,
  projectList,
  projectOpen,
  optionsMake,
  renderLook,
  planTool,
  askUser,
  finishTool,
] as Tool[];

/** O que o sub-laço de uma opção pode usar: desenhar e ler, nada que grave. */
export const OPTION_TOOLS: Tool[] = [stateRead, partsList, quoteRead, designApply, placeTool, modifyTool, rowBuild, finishTool] as Tool[];

/** Ferramentas que encerram o pedido. */
export const TERMINAL = new Set(['finish', 'ask_user']);
