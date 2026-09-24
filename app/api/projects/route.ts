import { applyShelfOp, applyRequest, create, createDemo, createFromTemplate, fork, list, get, view, save, revise, seek, remove } from '@/lib/store';
import { sameOrigin } from '@/lib/utils';
import { designSchema, opSchema } from '@/lib/studio';
import { z } from 'zod';
import { validationMessage } from '@/lib/composition';
import { roomSchema } from '@/lib/room';
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
      .object({ action: z.literal('template'), template: z.string().min(1).max(40) })
      .safeParse(body);
    if (fromTemplate.success) return Response.json(createFromTemplate(fromTemplate.data.template));
    const b = z
      .object({
        id: z.uuid(),
        version: z.number().int(),
        action: z.enum(['update', 'undo', 'redo', 'rename', 'seek', 'op', 'ops', 'fork', 'delete', 'room']),
        cursor: z.number().int().optional(),
        op: opSchema.optional(),
        ops:z.array(opSchema).min(1).max(32).optional(),
        label: z.string().trim().min(1).max(90).optional(),
        name: z.string().trim().min(1).max(80).optional(),
        design: designSchema.optional(),
        room: roomSchema.optional(),
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
      const result=applyRequest(p,b.ops,b.label??'Edição de composição');
      if(!result.ok)return Response.json({error:result.error},{status:422});
      if(result.noop)return Response.json({...view(p),noop:true,discarded:0});
      discarded = result.discarded;
    }
    if (b.action === 'undo') p.cursor = Math.max(0, p.cursor - 1);
    if (b.action === 'redo')
      p.cursor = Math.min(p.revisions.length - 1, p.cursor + 1);
    if (b.action === 'rename' && b.name) p.name = b.name;
    if (b.action === 'room') {
      if (!b.room) throw new Error('Informe as medidas do ambiente.');
      // Ambiente é dado do lugar, não do móvel: não abre revisão no histórico.
      p.room = b.room;
    }
    if (b.action === 'seek') seek(p, b.cursor ?? -1);
    if (b.action === 'fork')
      return Response.json(fork(b.id, b.cursor ?? p.cursor, b.name ?? `${p.name} · alternativa`));
    return Response.json({ ...save(p, b.version), discarded });
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
