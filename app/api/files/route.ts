import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { fileBytes, fileMeta, fileNote, makeFileBlock, MAX_FILE_BYTES, saveFile } from '@/lib/files';
import { mergePrices } from '@/lib/quote';
import { FILE_FORMAT_IDS, FILE_FORMATS, fileName, type FileBlock, type FileFormat } from '@/lib/rich';
import { get, save, view, waitTurn, type Message, type Project } from '@/lib/store';
import { sameOrigin } from '@/lib/utils';

/**
 * Arquivos da conversa.
 *
 * GET ?id=…            os bytes, para abrir na própria página (prévia).
 * GET ?id=…&download=1 os mesmos bytes como download.
 * GET ?id=…&meta=1     só a metadata (o cartão confere se o arquivo existe).
 * POST JSON {action:'generate'} gera um arquivo do servidor numa mensagem nova.
 * POST JSON {action:'fail'}     o navegador não conseguiu gerar o pendente.
 * POST imagem ou vídeo (corpo cru) o navegador entrega a foto ou o vídeo pendente.
 */
export async function GET(req: Request) {
  const q = new URL(req.url).searchParams;
  const id = q.get('id') || '';
  try {
    const meta = await fileMeta(id);
    if (q.get('meta')) return Response.json(meta, { headers: { 'Cache-Control': 'no-store' } });
    const bytes = await fileBytes(id);
    const disposition = `${q.get('download') ? 'attachment' : 'inline'}; filename="${ascii(meta.name)}"; filename*=UTF-8''${encodeURIComponent(meta.name)}`;
    return new Response(new Uint8Array(bytes), {
      headers: {
        'Content-Type': meta.mime,
        'Content-Length': String(bytes.length),
        'Content-Disposition': disposition,
        'X-Content-Type-Options': 'nosniff',
        // Arquivo é fotografia: o mesmo id nunca muda de conteúdo.
        'Cache-Control': 'private, max-age=31536000, immutable',
      },
    });
  } catch {
    return Response.json({ error: 'Arquivo não encontrado.' }, { status: 404 });
  }
}

/** Nome só com ASCII para o `filename=` antigo; o `filename*` leva o original. */
function ascii(name: string) {
  return name.normalize('NFD').replace(/[^\x20-\x7e]/g, '').replace(/"/g, '') || 'arquivo';
}

const generateSchema = z
  .object({
    action: z.literal('generate'),
    id: z.uuid(),
    format: z.enum(FILE_FORMAT_IDS as [FileFormat, ...FileFormat[]]),
    /** Versão de onde sai (padrão: a vigente). Precisa existir. */
    revisionId: z.string().min(1).max(80).optional(),
    prices: z.unknown().optional(),
    /** De onde veio o pedido: o cartão que a pessoa clicou. */
    from: z.string().max(60).optional(),
  })
  .strict();
const failSchema = z
  .object({
    action: z.literal('fail'),
    id: z.uuid(),
    messageId: z.string().min(1).max(80),
    blockId: z.uuid(),
    error: z.string().max(300),
  })
  .strict();

function findBlock(p: Project, messageId: string, blockId: string) {
  const m = p.messages.find((v) => v.id === messageId);
  const i = m?.blocks?.findIndex((b) => b.id === blockId && b.kind === 'file') ?? -1;
  if (!m || i < 0) throw new Error('Não encontrei o cartão do arquivo nesta conversa. Recarregue.');
  return { m, i, block: m.blocks![i] as FileBlock };
}

export async function POST(req: Request) {
  try {
    if (!sameOrigin(req)) return Response.json({ error: 'Origem inválida' }, { status: 403 });
    const type = req.headers.get('content-type') || '';
    if (/^(image|video)\//.test(type)) return await upload(req);
    const body = await req.json();
    const failed = failSchema.safeParse(body);
    if (failed.success) {
      const b = failed.data;
      await waitTurn(b.id);
      const p = get(b.id);
      const { m, i, block } = findBlock(p, b.messageId, b.blockId);
      if (block.status === 'pending') m.blocks![i] = { ...block, status: 'failed', error: b.error };
      return Response.json(save(p, p.version));
    }
    const b = generateSchema.parse(body);
    await waitTurn(b.id);
    const p = get(b.id);
    const index = b.revisionId ? p.revisions.findIndex((r) => r.id === b.revisionId) : p.cursor;
    if (index < 0) throw new Error('Esta versão foi descartada; gere o arquivo a partir da versão atual.');
    const block = await makeFileBlock(p, b.format, mergePrices(b.prices), index);
    const rev = p.revisions[index];
    const note: Message = {
      id: randomUUID(),
      role: 'assistant',
      content: fileNote(block),
      revisionId: p.revisions[p.cursor].id,
      revision: p.revisions[p.cursor].number,
      blocks: [block],
      action: b.from ?? 'card',
      result: { outcome: 'answered', resultRevisionId: rev.id, appliedOperations: [], changes: [] },
    };
    p.messages.push(note);
    return Response.json(save(p, p.version));
  } catch (e) {
    return Response.json({ error: e instanceof z.ZodError ? 'Pedido de arquivo inválido.' : (e as Error).message }, { status: 400 });
  }
}

/**
 * Foto ou vídeo que a página gravou para um cartão pendente. O corpo é o
 * arquivo cru (Content-Type do arquivo) e os campos vão na URL: um envio
 * multipart acima de 1 MB é tratado pelo vinext como formulário de server
 * action e recusado antes de chegar aqui.
 */
async function upload(req: Request) {
  if (Number(req.headers.get('content-length')) > MAX_FILE_BYTES) throw new Error('O arquivo passa de 40 MB.');
  const q = new URL(req.url).searchParams;
  const fields = z
    .object({
      id: z.uuid(),
      messageId: z.string().min(1).max(80),
      blockId: z.uuid(),
      durationMs: z.coerce.number().int().min(0).max(3_600_000).optional(),
      width: z.coerce.number().int().min(1).max(10000).optional(),
      height: z.coerce.number().int().min(1).max(10000).optional(),
    })
    .parse({
      id: q.get('id'),
      messageId: q.get('messageId'),
      blockId: q.get('blockId'),
      durationMs: q.get('durationMs') ?? undefined,
      width: q.get('width') ?? undefined,
      height: q.get('height') ?? undefined,
    });
  const reader = req.body?.getReader();
  if (!reader) throw new Error('Envie o arquivo.');
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.length;
      if (total > MAX_FILE_BYTES) {
        await reader.cancel();
        throw new Error('O arquivo passa de 40 MB.');
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) {
    bytes.set(c, at);
    at += c.length;
  }
  await waitTurn(fields.id);
  const p = get(fields.id);
  const { m, i, block } = findBlock(p, fields.messageId, fields.blockId);
  if (block.status === 'ready') return Response.json(view(p));
  const spec = FILE_FORMATS[block.format];
  if (spec.made !== 'client') throw new Error('Este arquivo é gerado pelo servidor.');
  const mime = (req.headers.get('content-type') || spec.mime).split(';')[0].trim();
  const allowed = spec.kind === 'image' ? /^image\/(png|jpeg|webp)$/ : /^video\/(webm|mp4)$/;
  if (!allowed.test(mime)) throw new Error('Formato de arquivo inesperado.');
  const rev = p.revisions.find((r) => r.id === block.revisionId);
  const ext = mime === 'video/mp4' ? 'mp4' : mime === 'image/jpeg' ? 'jpg' : mime === 'image/webp' ? 'webp' : spec.ext;
  const meta = await saveFile(bytes, {
    name: fileName(p.name, block.format, block.revision, block.generation).replace(/\.[a-z0-9]+$/, `.${ext}`),
    mime,
    kind: spec.kind,
    description: block.format === 'video' ? 'O móvel dando uma volta inteira, da versão gravada' : 'O móvel em foto, do mesmo ângulo do PDF',
    projectId: p.id,
    ...(rev ? { revisionId: rev.id, revision: rev.number } : {}),
    format: block.format,
    ...(fields.durationMs ? { durationMs: fields.durationMs } : {}),
    ...(fields.width ? { width: fields.width } : {}),
    ...(fields.height ? { height: fields.height } : {}),
  });
  m.blocks![i] = { ...block, status: 'ready', file: meta, error: undefined };
  return Response.json(save(p, p.version));
}
