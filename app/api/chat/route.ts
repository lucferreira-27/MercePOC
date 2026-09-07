import { get, save, revise } from '@/lib/store';
import { interpret } from '@/lib/gateway';
import { paramsSchema } from '@/lib/furniture';
import { z } from 'zod';
const busy = new Set<string>();
export async function POST(req: Request) {
  let id: string | undefined;
  try {
    const origin = req.headers.get('origin');
    if (origin && origin !== new URL(req.url).origin)
      return Response.json({ error: 'Origem inválida' }, { status: 403 });
    const b = z
      .object({
        id: z.uuid(),
        version: z.number().int(),
        message: z.string().trim().min(1).max(4000),
        selected: z.string().max(100).nullable().optional(),
      })
      .parse(await req.json());
    if (busy.has(b.id))
      return Response.json(
        { error: 'Aguarde a resposta anterior.' },
        { status: 409 },
      );
    id = b.id;
    busy.add(id);
    const p = get(id);
    if (p.version !== b.version)
      throw new Error('O projeto mudou. Recarregue e tente novamente.');
    p.messages.push({ role: 'user', content: b.message });
    const d = await interpret(
      p.revisions[p.cursor].params,
      p.messages,
      b.selected ?? null,
    );
    let message = d.message;
    try {
      if (d.action === 'update') {
        if (Object.keys(d.changes).length === 0)
          throw new Error('Nenhum parâmetro foi especificado.');
        revise(
          p,
          paramsSchema.parse({ ...p.revisions[p.cursor].params, ...d.changes }),
          b.message.slice(0, 90),
        );
      }
      if (d.action === 'undo') {
        if (p.cursor === 0) message = 'Você já está na primeira versão.';
        else p.cursor--;
      }
      if (d.action === 'redo') {
        if (p.cursor === p.revisions.length - 1)
          message = 'Não há alteração para refazer.';
        else p.cursor++;
      }
    } catch (e) {
      message = `Não apliquei a alteração: ${(e as Error).message}`;
    }
    p.messages.push({ role: 'assistant', content: message });
    return Response.json(save(p, b.version));
  } catch (e) {
    return Response.json(
      {
        error:
          e instanceof z.ZodError ? 'Pedido inválido.' : (e as Error).message,
      },
      { status: 400 },
    );
  } finally {
    if (id) busy.delete(id);
  }
}
