import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { putFile, readFileBytes, readFileMeta } from '#platform';
import { exportFile } from './exports';
import type { Prices } from './quote';
import { FILE_FORMATS, fileName, kindOfMime, type FileBlock, type FileFormat, type FileMeta } from './rich';
import type { Message, Project } from './store';

/**
 * Arquivos gerados que a conversa guarda (PDF, CSV, JSON, foto, vídeo). Cada
 * um é uma fotografia: gerado uma vez, nunca reescrito. Editar o orçamento
 * depois não muda o PDF de antes; gerar de novo cria outro arquivo, e o
 * cartão diz qual substitui qual.
 */
export const MAX_FILE_BYTES = 40 * 1024 * 1024;

export async function saveFile(bytes: Uint8Array, meta: Omit<FileMeta, 'id' | 'size' | 'createdAt' | 'kind'> & Partial<Pick<FileMeta, 'kind'>>) {
  if (!bytes.length) throw new Error('Arquivo vazio.');
  if (bytes.length > MAX_FILE_BYTES) throw new Error('O arquivo passa de 40 MB.');
  const full: FileMeta = {
    ...meta,
    id: randomUUID(),
    name: cleanName(meta.name),
    kind: meta.kind ?? kindOfMime(meta.mime),
    size: bytes.length,
    createdAt: new Date().toISOString(),
  };
  await putFile(full.id, bytes, JSON.stringify(full));
  return full;
}

export async function fileMeta(id: string): Promise<FileMeta> {
  try {
    return JSON.parse(await readFileMeta(z.uuid().parse(id))) as FileMeta;
  } catch {
    throw new Error('Arquivo não encontrado.');
  }
}

export async function fileBytes(id: string) {
  return readFileBytes(z.uuid().parse(id));
}

/** Nome seguro para o cabeçalho de download: sem barra nem controle. */
function cleanName(name: string) {
  return (
    Array.from(name)
      .filter((c) => {
        const code = c.codePointAt(0) || 0;
        return code >= 32 && code !== 127 && c !== '/' && c !== '\\' && c !== '"';
      })
      .join('')
      .slice(0, 140) || 'arquivo'
  );
}

/** Último arquivo deste formato na conversa: a geração nova o substitui. */
export function previousOf(messages: readonly Message[], format: FileFormat) {
  for (let i = messages.length - 1; i >= 0; i--) {
    const found = messages[i].blocks?.findLast((b): b is FileBlock => b.kind === 'file' && b.format === format);
    if (found) return found;
  }
  return null;
}

/**
 * Bloco de arquivo para a mensagem. Formato do servidor sai pronto, gerado
 * da versão `index`; formato do navegador nasce pendente, e a página grava e
 * envia (POST /api/files com o id do bloco).
 */
export async function makeFileBlock(p: Project, format: FileFormat, prices: Prices, index = p.cursor, extra: FileBlock[] = []): Promise<FileBlock> {
  const rev = p.revisions[index];
  const before = [...p.messages, { id: 'turn', role: 'assistant', content: '', blocks: extra } as Message];
  const previous = previousOf(before, format);
  const generation = (previous?.generation ?? 0) + 1;
  const base = {
    kind: 'file' as const,
    id: randomUUID(),
    format,
    revisionId: rev.id,
    revision: rev.number,
    generation,
    ...(previous?.file ? { supersedes: previous.file.id } : {}),
  };
  if (FILE_FORMATS[format].made === 'client') return { ...base, status: 'pending', file: null };
  try {
    const out = exportFile(format, { project: p, index, prices });
    // Prévia das páginas guardada à parte: o cartão e a janela leem sem PDF.
    const preview = out.svg?.length
      ? await saveFile(new TextEncoder().encode(JSON.stringify(out.svg)), { name: 'paginas.json', mime: 'application/json', kind: 'document' })
      : null;
    const file = await saveFile(out.bytes, {
      ...(preview ? { preview: preview.id } : {}),
      name: fileName(p.name, format, rev.number, generation),
      mime: out.mime,
      kind: FILE_FORMATS[format].kind,
      ...(out.pages ? { pages: out.pages } : {}),
      description: out.description,
      projectId: p.id,
      revisionId: rev.id,
      revision: rev.number,
      format,
    });
    return { ...base, status: 'ready', file };
  } catch (e) {
    return { ...base, status: 'failed', file: null, error: (e as Error).message.slice(0, 200) };
  }
}

/** Frase da mensagem que só traz um arquivo (gerado por um cartão). */
export function fileNote(block: FileBlock) {
  const what = FILE_FORMATS[block.format].label;
  if (block.status === 'failed') return `Não consegui gerar o ${what.toLowerCase()} da versão ${block.revision}.`;
  return `${what} da versão ${block.revision}${block.generation > 1 ? ` (${block.generation}ª geração; a anterior continua na conversa)` : ''}.`;
}
