import { z } from 'zod';
import { isFlat, type Composition, type Module } from '../composition';
import type { Room } from '../room';
import type { Design, ShelfOp } from '../studio';
import { clearOps, interiorOps, interiorSchema } from './interior';
import { resolvePiece, whereSchema, type Piece } from './place';
import { sceneOf } from './scene';

/**
 * Edições completas de módulos que já existem, com a contabilidade do app:
 * tirar (as conexões saem junto e os vizinhos ficam), mover para um lugar
 * dito por relação, mudar medidas (a fileira de painel compartilhado muda
 * junto) e trocar o interior inteiro. A IA diz o quê; o app acha os ids,
 * a ordem das operações e as posições.
 */
export const modifySchema = z
  .object({
    remover: z.array(z.string().max(100)).max(12).optional().describe('Ids de módulos a tirar; quem estava ligado a eles fica no lugar'),
    mover: z
      .array(
        z
          .object({
            id: z.string().max(100),
            onde: whereSchema.describe('Como em place; sem de, x e y ausentes ficam como estão e o fundo vai para a parede (ou o painel)'),
            sozinho: z
              .boolean()
              .optional()
              .describe('Solta o módulo dos vizinhos e move só ele; sem isto o conjunto ligado anda junto, como no arrasto'),
          })
          .strict(),
      )
      .max(12)
      .optional(),
    medidas: z
      .array(
        z
          .object({
            id: z.string().max(100),
            largura: z.number().min(200).max(2700).optional(),
            altura: z.number().min(200).max(2700).optional().describe('Altura da caixa, sem os pés'),
            altura_total: z.number().min(200).max(3000).optional().describe('Altura com os pés (bancada de 90 cm = 900)'),
            profundidade: z.number().min(15).max(800).optional(),
            pes: z.number().min(0).max(300).optional(),
            manter: z.enum(['esquerda', 'direita', 'centro']).optional().describe('Que borda fica no lugar quando a largura muda (padrão esquerda)'),
          })
          .strict(),
      )
      .max(12)
      .optional(),
    interior: z
      .array(interiorSchema.extend({ id: z.string().max(100) }).strict())
      .max(12)
      .optional()
      .describe('Troca o interior do módulo inteiro (frentes e divisões antigas saem)'),
    rotulo: z.string().max(90).optional(),
  })
  .strict();
export type Modify = z.infer<typeof modifySchema>;

/** Módulos ligados por painel compartilhado de lado a lado: altura, profundidade e pés são uma coisa só. */
export function sharedRow(d: Composition, id: string) {
  const row = new Set([id]);
  for (let grew = true; grew; ) {
    grew = false;
    for (const c of d.connections.filter((v) => v.shared && v.side !== 'top'))
      for (const [a, b] of [
        [c.parent, c.child],
        [c.child, c.parent],
      ])
        if (row.has(a) && !row.has(b)) {
          row.add(b);
          grew = true;
        }
  }
  return [...row];
}

/** A raiz do conjunto ligado: o módulo que não é filho de ninguém. */
function rootOf(d: Composition, id: string) {
  let cur = id;
  for (let i = 0; i < 20; i++) {
    const up = d.connections.find((c) => c.child === cur);
    if (!up) return cur;
    cur = up.parent;
  }
  return cur;
}

/** O módulo e os que andam com ele (filhos das conexões). */
function groupOf(d: Composition, id: string) {
  const out = new Set([id]);
  for (let grew = true; grew; ) {
    grew = false;
    for (const c of d.connections) if (out.has(c.parent) && !out.has(c.child)) {
      out.add(c.child);
      grew = true;
    }
  }
  return out;
}

const byId = (d: Composition, id: string) => d.modules.find((m) => m.id === id) ?? d.modules.find((m) => m.name.toLowerCase() === id.trim().toLowerCase());

/**
 * Pedido de edição → operações, na ordem que o motor aceita. Volta o erro em
 * frase na primeira coisa que não fecha, com o que caberia.
 */
export function planModify(design: Design, room: Room | undefined, a: Modify): { ops: ShelfOp[]; lines: string[] } | { error: string } {
  const ops: ShelfOp[] = [];
  const lines: string[] = [];
  const missing = (id: string) => ({ error: `Módulo "${id}" não existe. Ids: ${design.modules.map((m) => `${m.id} (${m.name})`).slice(0, 14).join(', ')}.` });
  // Medidas antes de mover: a posição nova já conta com o tamanho novo.
  for (const e of a.medidas ?? []) {
    const m = byId(design, e.id);
    if (!m) return missing(e.id);
    const feet = e.pes ?? m.feet ?? 0;
    // As duas juntas valem quando batem (a IA costuma mandar todos os campos).
    if (e.altura !== undefined && e.altura_total !== undefined && e.altura + feet !== e.altura_total)
      return {
        error: `${m.name}: altura da caixa ${e.altura} + pés ${feet} = ${e.altura + feet} mm, mas altura_total diz ${e.altura_total} mm. Mande só altura_total (com os pés) ou só altura (da caixa).`,
      };
    const height = e.altura_total !== undefined ? e.altura_total - feet : e.altura;
    if (height !== undefined && !isFlat(m) && (height < 200 || height > 2400))
      // Sem pés na conta: a mensagem não sugere pôr pés para passar do limite.
      return {
        error: `${m.name}: altura de ${e.altura_total ?? height} mm fora do limite (caixa de 200 a 2400 mm${e.altura_total !== undefined && feet ? `, mais ${feet} mm dos pés que ela já tem` : ''}). Faça no limite e diga isso na resposta.`,
      };
    const row = isFlat(m) ? [m.id] : sharedRow(design, m.id);
    const shared: Partial<Module> = {
      ...(height !== undefined ? { height } : {}),
      ...(e.profundidade !== undefined ? { depth: e.profundidade } : {}),
      ...(e.pes !== undefined ? { feet: e.pes } : {}),
    };
    if (Object.keys(shared).length)
      for (const id of row) ops.push({ kind: 'module.edit', id, ...shared } as ShelfOp);
    if (e.largura !== undefined && e.largura !== m.width) {
      const child = design.connections.some((c) => c.child === m.id);
      const dw = e.largura - m.width;
      const keep = e.manter ?? 'esquerda';
      // Raiz: a posição é o centro, então manter uma borda é andar meia diferença.
      const shift = child || keep === 'centro' ? 0 : keep === 'esquerda' ? dw / 2 : -dw / 2;
      ops.push({
        kind: 'module.edit',
        id: m.id,
        width: e.largura,
        ...(shift ? { position: [m.position[0] + shift, m.position[1], m.position[2]] as [number, number, number] } : {}),
      });
      if (child && keep !== 'esquerda') lines.push(`${m.name}: ligado ao vizinho da esquerda, a borda esquerda fica e os da direita andam junto.`);
    }
    const what = [
      height !== undefined && `altura da caixa ${height} mm${feet ? ` (+${feet} de pés = ${height + feet})` : ''}`,
      e.profundidade !== undefined && `profundidade ${e.profundidade} mm`,
      e.pes !== undefined && `pés ${e.pes} mm`,
      e.largura !== undefined && `largura ${e.largura} mm`,
    ].filter(Boolean);
    lines.push(`${m.name}: ${what.join(', ')}${row.length > 1 && Object.keys(shared).length ? ` (a fileira com painel compartilhado muda junto: ${row.length} módulos)` : ''}.`);
  }
  // Interior: esvazia (frentes e divisões, na ordem) e monta o novo.
  for (const e of a.interior ?? []) {
    const m = byId(design, e.id);
    if (!m) return missing(e.id);
    if (isFlat(m)) return { error: `${m.name} é ${m.kind === 'ledge' ? 'uma prateleira de parede' : 'um painel de parede'}: não tem interior.` };
    const { id: _id, ...spec } = e;
    void _id;
    const size = { width: m.width, height: m.height };
    const inside = interiorOps(m.id, size, spec, m.root.id);
    if ('error' in inside) return { error: `${m.name}: ${inside.error}` };
    ops.push(...clearOps(m), ...inside.ops);
    lines.push(`${m.name}: interior novo, vãos (de baixo para cima) ${inside.cells.map((r) => r.join(' ')).join(' | ')}${inside.notes.length ? ` (${inside.notes.join('; ')})` : ''}.`);
  }
  // Mover: onde a peça fica pela mesma conta das peças novas, ignorando ela e quem anda junto.
  if (a.mover?.length) {
    const scene = sceneOf(design, room);
    const moved = new Set<string>();
    for (const e of a.mover) {
      const m = byId(design, e.id);
      if (!m) return missing(e.id);
      const cur = scene.modules.find((v) => v.id === m.id)!;
      // Como no arrasto: o conjunto ligado anda junto, pela raiz. Mover um
      // aéreo do meio da fileira soltava ele e batia no vizinho torto.
      const root = e.sozinho ? m.id : rootOf(design, m.id);
      const group = groupOf(design, root);
      if (!e.sozinho && moved.has(root)) {
        lines.push(`${m.name}: anda junto com o conjunto já movido.`);
        continue;
      }
      moved.add(root);
      const where = { ...e.onde };
      if (!where.de) {
        where.x ??= cur.x0;
        where.y ??= cur.y0;
      }
      const piece: Piece = {
        ref: m.id,
        nome: m.name,
        tipo: m.kind === 'panel' ? 'painel' : m.kind === 'ledge' ? 'prateleira' : 'nicho',
        largura: cur.x1 - cur.x0,
        altura: m.height,
        profundidade: m.depth,
        pes: m.feet ?? 0,
        onde: where,
      };
      const r = resolvePiece(scene, design, piece, [], group);
      if ('error' in r) return { error: `Mover ${m.name}: ${r.error}` };
      const dx = r.box.x0 - cur.x0,
        dy = r.box.y0 - cur.y0,
        dz = r.box.d0 - cur.d0;
      if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5 && Math.abs(dz) < 0.5) {
        lines.push(`${m.name}: já estava nesse lugar.`);
        continue;
      }
      // Sozinho: sai da conexão (e leva os filhos dele). Junto: anda a raiz.
      const parent = e.sozinho ? design.connections.find((c) => c.child === m.id) : undefined;
      if (parent) ops.push({ kind: 'disconnect', child: m.id });
      const lead = design.modules.find((v) => v.id === root)!;
      ops.push({ kind: 'module.edit', id: lead.id, position: [lead.position[0] + dx, lead.position[1] + dy, lead.position[2] + dz] });
      // O suspenso que desce ao piso deixa de ser suspenso, e vice-versa.
      for (const id of group) {
        const v = design.modules.find((x) => x.id === id)!;
        const box = scene.modules.find((x) => x.id === id);
        if (isFlat(v) || !box) continue;
        const wall = box.y0 + dy > 5;
        if (!!v.wall !== wall) ops.push({ kind: 'module.edit', id, wall });
      }
      lines.push(
        `${m.name}${group.size > 1 ? ` (com ${group.size - 1} ligado${group.size > 2 ? 's' : ''})` : ''}: agora em x ${Math.round(r.box.x0)}–${Math.round(r.box.x1)}, y ${Math.round(r.box.y0)}–${Math.round(r.box.y1)} mm, ${r.box.d0 === 0 ? 'encostado na parede' : `preso no ${r.surface}`}${parent ? '; saiu da conexão com o vizinho' : ''}.`,
      );
    }
  }
  for (const id of a.remover ?? []) {
    const m = byId(design, id);
    if (!m) return missing(id);
    ops.push({ kind: 'module.remove', id: m.id });
    lines.push(`${m.name}: removido (quem estava ligado a ele ficou no lugar).`);
  }
  if (!ops.length && !lines.length) return { error: 'Nada para fazer: diga remover, mover, medidas ou interior.' };
  return { ops, lines };
}
