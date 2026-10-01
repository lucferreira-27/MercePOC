import { applyShelfOp, applyRequest, applyPlacement, reviseRoom, undo, redo, create, createDemo, createFromTemplate, fork, list, get, view, save, revise, seek, remove, clearChat, restoreChat } from '@/lib/store';
import { sameOrigin } from '@/lib/utils';
import { designSchema, opSchema } from '@/lib/studio';
import { z } from 'zod';
import { validationMessage } from '@/lib/composition';
import { obstacleClash, roomChangeLabel, roomSchema } from '@/lib/room';
import { placementRoot } from '@/lib/placement';
import { STYLE_IDS } from '@/lib/look';
export async function GET(req: Request) {
  try {
    const id = new URL(req.url).searchParams.get('id');
    return Response.json(id ? view(get(id)) : list());
  } catch {
    return Response.json({ error: 'Projeto não encontrado.' }, { status: 404 });
  }
}
export async function POST(req: Request) {
  try {
    if (!sameOrigin(req))
      return Response.json({ error: 'Origem inválida' }, { status: 403 });
    const body = await req.json();
    const setup = z.object({ action: z.enum(['create', 'demo']) }).safeParse(body);
    if (setup.success)
      return Response.json(setup.data.action === 'demo' ? createDemo() : create());
    const fromTemplate = z
      .object({ action: z.literal('template'), template: z.string().min(1).max(40), style: z.enum(STYLE_IDS).optional() })
      .safeParse(body);
    if (fromTemplate.success) return Response.json(createFromTemplate(fromTemplate.data.template, fromTemplate.data.style));
    const b = z
      .object({
        id: z.uuid(),
        version: z.number().int(),
        action: z.enum(['update', 'undo', 'redo', 'rename', 'seek', 'op', 'ops', 'fork', 'delete', 'room', 'chat-clear', 'chat-restore']),
        cursor: z.number().int().optional(),
        op: opSchema.optional(),
        ops:z.array(opSchema).min(1).max(32).optional(),
        label: z.string().trim().min(1).max(90).optional(),
        name: z.string().trim().min(1).max(80).optional(),
        design: designSchema.optional(),
        room: roomSchema.optional(),
        /** Movimento do móvel: segue a sequência na mesma versão quando dá. */
        placement: z.boolean().optional(),
      })
      .parse(body);
    const p = get(b.id);
    // Quantas versões futuras esta edição descarta: o cliente avisa o usuário.
    let discarded = 0;
    // Excluir não depende da versão: o projeto deixa de existir.
    if (b.action === 'delete') return Response.json(remove(b.id));
    if (p.version !== b.version)
      throw new Error('Projeto desatualizado. Recarregue.');
    if (b.action === 'update' && b.design)
      discarded = revise(p, designSchema.parse(b.design), b.label ?? 'Ajuste de parâmetros');
    if (b.action === 'op' && b.op) {
      try {
        const applied = applyShelfOp(p, b.op, b.label ?? 'Edição de prateleira');
        if (applied.noop) return Response.json({ ...view(p), noop: true, discarded: 0 });
        discarded = applied.discarded;
      } catch (e) {
        return Response.json({ error: (e as Error).message }, { status: 422 });
      }
    }
    if(b.action==='ops'){
      if(!b.ops)throw new Error('Informe as operações do pedido.');
      const root = b.placement ? placementRoot(b.ops) : null;
      // Móvel arrastado com ambiente real: a distância do canto vem junto, e
      // a versão nova guarda o ambiente com ela.
      const roomBefore = p.room;
      if (b.room) p.room = b.room;
      const result = root
        ? applyPlacement(p, b.ops, b.label ?? 'Moveu o móvel', root)
        : applyRequest(p, b.ops, b.label ?? 'Edição de composição');
      if (!result.ok || result.noop) p.room = roomBefore;
      if(!result.ok)return Response.json({error:result.error},{status:422});
      if(result.noop)return Response.json({...view(p),noop:true,discarded:0});
      discarded = result.discarded;
    }
    // Desfazer/refazer: um movimento da sequência antes de trocar de versão.
    let step: 'step' | 'version' | null = null;
    // Passou por uma versão de movimentos: o cliente não anuncia medida geral.
    let moved = false;
    if (b.action === 'undo') {
      const left = p.revisions[p.cursor];
      step = undo(p);
      moved = !!left.placement;
    }
    if (b.action === 'redo') {
      step = redo(p);
      moved = !!p.revisions[p.cursor].placement;
    }
    if (b.action === 'rename' && b.name) p.name = b.name;
    if (b.action === 'room') {
      if (!b.room) throw new Error('Informe as medidas do ambiente.');
      // Dois obstáculos no mesmo lugar da parede não existem: recusa com o par.
      const clash = obstacleClash(b.room.obstacles ?? []);
      if (clash) return Response.json({ error: clash }, { status: 422 });
      // Obstáculo posto, movido ou tirado vira versão: entra no Ctrl+Z e no
      // histórico. Arrastos seguidos do mesmo obstáculo ficam numa só.
      const changed = reviseRoom(p, b.room, b.label ?? roomChangeLabel(p.room, b.room));
      if (changed.noop) return Response.json({ ...view(p), noop: true, discarded: 0 });
      discarded = changed.discarded;
    }
    if (b.action === 'seek') seek(p, b.cursor ?? -1);
    if (b.action === 'chat-clear' && clearChat(p).noop) return Response.json({ ...view(p), noop: true, discarded: 0 });
    if (b.action === 'chat-restore') restoreChat(p);
    if (b.action === 'fork')
      return Response.json(fork(b.id, b.cursor ?? p.cursor, b.name ?? `${p.name} · alternativa`));
    return Response.json({ ...save(p, b.version), discarded, ...(step === 'step' ? { step: true } : {}), ...(moved ? { moved: true } : {}) });
  } catch (e) {
    return Response.json(
      {
        error:
          e instanceof z.ZodError
            ? validationMessage(e)
            : (e as Error).message,
      },
      { status: 400 },
    );
  }
}
