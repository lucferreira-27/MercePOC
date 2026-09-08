import { applyShelfOp, create, createDemo, fork, list, get, view, save, revise, seek } from '@/lib/store';
import { designSchema, opSchema } from '@/lib/design';
import { z } from 'zod';
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
    const origin = req.headers.get('origin');
    if (origin && origin !== new URL(req.url).origin)
      return Response.json({ error: 'Origem inválida' }, { status: 403 });
    const body = await req.json();
    const setup = z.object({ action: z.enum(['create', 'demo']) }).safeParse(body);
    if (setup.success)
      return Response.json(setup.data.action === 'demo' ? createDemo() : create());
    const b = z
      .object({
        id: z.uuid(),
        version: z.number().int(),
        action: z.enum(['update', 'undo', 'redo', 'rename', 'seek', 'op', 'fork']),
        cursor: z.number().int().optional(),
        op: opSchema.optional(),
        label: z.string().trim().min(1).max(90).optional(),
        name: z.string().trim().min(1).max(80).optional(),
        design: designSchema.optional(),
      })
      .parse(body);
    const p = get(b.id);
    if (p.version !== b.version)
      throw new Error('Projeto desatualizado. Recarregue.');
    if (b.action === 'update' && b.design)
      revise(p, designSchema.parse(b.design), b.label ?? 'Ajuste de parâmetros');
    if (b.action === 'op' && b.op) {
      try {
        if (applyShelfOp(p, b.op, b.label ?? 'Edição de prateleira'))
          return Response.json({ ...view(p), noop: true });
      } catch (e) {
        return Response.json({ error: (e as Error).message }, { status: 422 });
      }
    }
    if (b.action === 'undo') p.cursor = Math.max(0, p.cursor - 1);
    if (b.action === 'redo')
      p.cursor = Math.min(p.revisions.length - 1, p.cursor + 1);
    if (b.action === 'rename' && b.name) p.name = b.name;
    if (b.action === 'seek') seek(p, b.cursor ?? -1);
    if (b.action === 'fork')
      return Response.json(fork(b.id, b.cursor ?? p.cursor, b.name ?? `${p.name} · alternativa`));
    return Response.json(save(p, b.version));
  } catch (e) {
    return Response.json(
      {
        error:
          e instanceof z.ZodError
            ? 'Parâmetros fora dos limites permitidos.'
            : (e as Error).message,
      },
      { status: 400 },
    );
  }
}
