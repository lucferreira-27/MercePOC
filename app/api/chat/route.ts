import { applyShelfOp, get, save } from '@/lib/store';
import { interpretStream } from '@/lib/gateway';
import { materials } from '@/lib/furniture';
import {
  describeDesignChanges,
  generateDesign,
  resolveShelfId,
  shelfInfos,
  type ShelfOp,
} from '@/lib/design';
import {
  type Progress,
  type ChatReport,
  type TextPreview,
} from '@/lib/progress';
import { z } from 'zod';
import { getImage } from '@/lib/images';
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
        message: z.string().trim().max(4000),
        imageId: z.uuid().optional(),
        selected: z.array(z.string().max(100)).max(20).optional(),
      })
      .parse(await req.json());
    if (!b.message && !b.imageId) throw new Error('Escreva uma mensagem ou anexe uma imagem.');
    const image = b.imageId ? await getImage(b.imageId) : undefined;
    b.message ||= 'Use esta imagem como referência para a estante.';
    if (busy.has(b.id))
      return Response.json(
        { error: 'Aguarde a resposta anterior.' },
        { status: 409 },
      );
    const p = get(b.id);
    if (p.version !== b.version)
      throw new Error('O projeto mudou. Recarregue e tente novamente.');
    id = b.id;
    busy.add(id);
    const started = Date.now(),
      before = p.revisions[p.cursor].params,
      userRevision = p.revisions[p.cursor].number;
    p.messages.push({ role: 'user', content: b.message, ...(image ? { image } : {}), revision: userRevision });
    const run = async (
      progress: (event: Progress) => void,
      signal: AbortSignal,
      text: (preview: TextPreview) => void = () => {},
    ) => {
      const selected = (b.selected ?? [])
        .map((id) => resolveShelfId(id, before) ?? id)
        .filter((id, i, all) => all.indexOf(id) === i);
      const d = await interpretStream(
        before,
        p.messages,
        selected,
        progress,
        0,
        signal,
        text,
      );
      signal.throwIfAborted();
      progress({
        stage: 'validating',
        label: 'Conferindo o projeto',
        detail:
          d.action === 'update'
            ? 'Verificando medidas, vãos e peças antes de aplicar.'
            : 'Conferindo o pedido com a versão atual.',
      });
      let message = d.message,
        outcome: ChatReport['outcome'] =
          d.action === 'clarify' ? 'clarification' : 'unchanged';
      const ops = d.ops as ShelfOp[];
      try {
        if (d.action === 'update') {
          if (!ops.length && !d.select.length)
            throw new Error('Nenhuma operação foi especificada.');
          let noop = true;
          for (const op of ops) {
            if (applyShelfOp(p, op, b.message.slice(0, 90))) continue;
            noop = false;
          }
          if (!ops.length) noop = false;
          if (noop) {
            outcome = 'unchanged';
            message = `${d.message} (sem mudança nas medidas)`;
          }
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
        outcome = 'rejected';
        message = `Não apliquei a alteração: ${(e as Error).message}`;
      }
      const changes = describeDesignChanges(before, p.revisions[p.cursor].params);
      if (changes.length) outcome = 'updated';
      progress({
        stage: 'saving',
        label: 'Salvando o resultado',
        detail: changes.length
          ? 'Registrando a versão e preparando o modelo 3D.'
          : 'Salvando a resposta. As medidas foram preservadas.',
      });
      const design = p.revisions[p.cursor].params;
      const parts = generateDesign(design).parts;
      const infos = new Map(shelfInfos(design).map((s) => [s.id, s]));
      const color = materials.find((m) => m.id === design.materialId)?.color ?? '#999';
      const showcase = d.select
        .map((id) => resolveShelfId(id, design) ?? id)
        .map((id) => parts.find((part) => part.id === id))
        .filter((v) => v !== undefined)
        .map((v) => ({
          id: v.id,
          name: infos.get(v.id)?.label ?? v.name,
          dims: `${v.c} × ${v.l} × ${v.thickness} mm`,
          material: v.material,
          size: v.size,
          color,
        }));
      p.messages.push({
        role: 'assistant',
        content: message,
        revision: p.revisions[p.cursor].number,
        report: {
          durationMs: Date.now() - started,
          outcome,
          changes,
          approach: d.approach,
          selected: showcase,
        },
      });
      const state = save(p, b.version);
      return { ...state, selected: showcase.map((v) => v.id) };
    };
    if (!req.headers.get('accept')?.includes('text/event-stream')) {
      try {
        return Response.json(await run(() => {}, req.signal));
      } finally {
        busy.delete(b.id);
      }
    }
    const cancellation = new AbortController();
    let ended = false;
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        const enc = new TextEncoder();
        const send = (event: string, data: unknown) => {
          if (!ended) {
            try {
              controller.enqueue(
                enc.encode(
                  `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`,
                ),
              );
            } catch {
              ended = true;
              cancellation.abort();
            }
          }
        };
        const heartbeat = setInterval(
          () => send('heartbeat', { elapsedMs: Date.now() - started }),
          10000,
        );
        try {
          const result = await run(
            (event) => send('progress', event),
            AbortSignal.any([req.signal, cancellation.signal]),
            (preview) => {
              if (req.headers.get('x-chat-preview') !== 'hidden')
                send('text', preview);
            },
          );
          send('done', result);
        } catch (e) {
          send('error', {
            error:
              e instanceof Error && e.name === 'TimeoutError'
                ? 'A IA demorou mais que o esperado. Seu projeto foi preservado; tente novamente.'
                : (e as Error).message,
          });
        } finally {
          clearInterval(heartbeat);
          busy.delete(b.id);
          if (!ended) {
            ended = true;
            controller.close();
          }
        }
      },
      cancel() {
        ended = true;
        cancellation.abort();
      },
    });
    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        'X-Accel-Buffering': 'no',
      },
    });
  } catch (e) {
    if (id) busy.delete(id);
    return Response.json(
      {
        error:
          e instanceof z.ZodError ? 'Pedido inválido.' : (e as Error).message,
      },
      { status: 400 },
    );
  }
}
