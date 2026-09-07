import { create, list, get, view, save, revise } from '@/lib/store';
import { paramsSchema } from '@/lib/furniture';
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
    if (z.object({ action: z.literal('create') }).safeParse(body).success)
      return Response.json(create());
    const b = z
      .object({
        id: z.uuid(),
        version: z.number().int(),
        action: z.enum(['update', 'undo', 'redo', 'rename']),
        changes: paramsSchema.partial().optional(),
        name: z.string().trim().min(1).max(80).optional(),
      })
      .parse(body);
    const p = get(b.id);
    if (p.version !== b.version)
      throw new Error('Projeto desatualizado. Recarregue.');
    if (b.action === 'update')
      revise(
        p,
        paramsSchema.parse({ ...p.revisions[p.cursor].params, ...b.changes }),
        'Ajuste de parâmetros',
      );
    if (b.action === 'undo') p.cursor = Math.max(0, p.cursor - 1);
    if (b.action === 'redo')
      p.cursor = Math.min(p.revisions.length - 1, p.cursor + 1);
    if (b.action === 'rename' && b.name) p.name = b.name;
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
