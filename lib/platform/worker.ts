import { initWasm, Resvg } from '@resvg/resvg-wasm';
import resvgWasm from '@resvg/resvg-wasm/index_bg.wasm';
import type { Sql, SqlValue, StoredImage, TraceSink } from './types';

/**
 * Cloudflare: tudo mora no SQLite do Durable Object `Studio` (worker/index.ts).
 * Projetos, fotos e registros ficam no mesmo banco: sem R2 nem D1, e o
 * `lib/store.ts` continua síncrono como no Node.
 */
export const PLATFORM = 'cloudflare' as const;

let storage: SqlStorage | undefined;

/** O Durable Object chama ao nascer: o banco do app passa a ser o dele. */
export function bindStorage(sqlStorage: SqlStorage) {
  storage = sqlStorage;
  storage.exec(
    'CREATE TABLE IF NOT EXISTS projects (id TEXT PRIMARY KEY, body TEXT NOT NULL, version INTEGER NOT NULL, updated TEXT NOT NULL)',
  );
  storage.exec('CREATE TABLE IF NOT EXISTS images (id TEXT PRIMARY KEY, type TEXT NOT NULL, meta TEXT NOT NULL, chunks INTEGER NOT NULL)');
  storage.exec(
    'CREATE TABLE IF NOT EXISTS image_chunks (id TEXT NOT NULL, seq INTEGER NOT NULL, bytes BLOB NOT NULL, PRIMARY KEY (id, seq))',
  );
  storage.exec('CREATE TABLE IF NOT EXISTS files (id TEXT PRIMARY KEY, meta TEXT NOT NULL, chunks INTEGER NOT NULL)');
  storage.exec(
    'CREATE TABLE IF NOT EXISTS file_chunks (id TEXT NOT NULL, seq INTEGER NOT NULL, bytes BLOB NOT NULL, PRIMARY KEY (id, seq))',
  );
  storage.exec('CREATE TABLE IF NOT EXISTS traces (name TEXT PRIMARY KEY, day TEXT NOT NULL)');
  storage.exec(
    'CREATE TABLE IF NOT EXISTS trace_lines (name TEXT NOT NULL, seq INTEGER NOT NULL, line TEXT NOT NULL, PRIMARY KEY (name, seq))',
  );
}

function db() {
  if (!storage) throw new Error('Banco indisponível: a requisição não passou pelo Durable Object.');
  return storage;
}

/**
 * Cópia exata dos bytes. `Buffer#slice` devolve uma vista, e o `.buffer` dela
 * é a alocação inteira: um pedaço de 1 MB de uma foto de 4 MB ia com 4 MB.
 */
function exact(bytes: Uint8Array) {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

function bind(params: SqlValue[]) {
  return params.map((p) => (p instanceof Uint8Array ? exact(p) : p));
}

const sql: Sql = {
  all: <T>(query: string, ...params: SqlValue[]) => db().exec(query, ...bind(params)).toArray() as T[],
  get: <T>(query: string, ...params: SqlValue[]) => db().exec(query, ...bind(params)).toArray()[0] as T | undefined,
  run: (query: string, ...params: SqlValue[]) => {
    const cursor = db().exec(query, ...bind(params));
    cursor.toArray();
    return { changes: cursor.rowsWritten };
  },
};

export function openDatabase(): Sql {
  return sql;
}

export function backupDatabase(): string {
  throw new Error('Backup em arquivo só existe no Node. Na Cloudflare o Durable Object guarda 30 dias de histórico.');
}

/**
 * O registro vai para a tabela `trace_lines`; `/api/traces?name=` devolve o
 * JSONL. `name` é `AAAA-MM-DD/HHMMSS-pedido`, igual ao caminho no Node.
 */
export function traceSink(name: string): TraceSink | null {
  db().exec('INSERT OR IGNORE INTO traces VALUES (?, ?)', name, name.slice(0, 10));
  let seq = sql.get<{ n: number }>('SELECT coalesce(max(seq) + 1, 0) AS n FROM trace_lines WHERE name=?', name)?.n ?? 0;
  return {
    file: `trace:${name}`,
    append: (line) => {
      db().exec('INSERT INTO trace_lines VALUES (?, ?, ?)', name, seq++, line);
    },
  };
}

export function pruneTraces(oldest: string) {
  db().exec('DELETE FROM trace_lines WHERE name IN (SELECT name FROM traces WHERE day < ?)', oldest);
  db().exec('DELETE FROM traces WHERE day < ?', oldest);
}

export function listTraces(limit: number) {
  return sql.all<{ name: string }>('SELECT name FROM traces ORDER BY name DESC LIMIT ?', limit).map((r) => r.name);
}

export function readTrace(name: string) {
  const rows = sql.all<{ line: string }>('SELECT line FROM trace_lines WHERE name=? ORDER BY seq', name);
  return rows.length ? rows.map((r) => r.line).join('') : null;
}

function startsWith(bytes: Uint8Array, at: number, text: string) {
  for (let i = 0; i < text.length; i++) if (bytes[at + i] !== text.charCodeAt(i)) return false;
  return true;
}

function includes(bytes: Uint8Array, text: string) {
  outer: for (let i = 0; i + text.length <= bytes.length; i++) {
    for (let j = 0; j < text.length; j++) if (bytes[i + j] !== text.charCodeAt(j)) continue outer;
    return true;
  }
  return false;
}

/**
 * Sem `sharp` no Worker: o navegador já reduz a foto (lib/shrink-image.ts) e
 * aqui só se confere o formato pelos primeiros bytes, recusando animações.
 */
export async function normalizeImage(bytes: Uint8Array): Promise<StoredImage> {
  const bad = new Error('Use uma imagem estática JPG, PNG ou WebP.');
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return { bytes, type: 'image/jpeg' };
  if (startsWith(bytes, 0, '\x89PNG')) {
    if (includes(bytes, 'acTL')) throw bad;
    return { bytes, type: 'image/png' };
  }
  if (startsWith(bytes, 0, 'RIFF') && startsWith(bytes, 8, 'WEBP')) {
    if (startsWith(bytes, 12, 'VP8X') && (bytes[20] & 0x02) !== 0) throw bad;
    return { bytes, type: 'image/webp' };
  }
  throw bad;
}

/** Linhas do SQLite do Durable Object vão até 2 MB: a imagem é gravada em pedaços. */
const CHUNK = 1024 * 1024;

export async function putImage(id: string, image: StoredImage, meta: string) {
  const chunks = Math.max(1, Math.ceil(image.bytes.length / CHUNK));
  db().exec('DELETE FROM image_chunks WHERE id=?', id);
  for (let i = 0; i < chunks; i++)
    db().exec('INSERT INTO image_chunks VALUES (?, ?, ?)', id, i, exact(image.bytes.subarray(i * CHUNK, (i + 1) * CHUNK)));
  db().exec('INSERT OR REPLACE INTO images VALUES (?, ?, ?, ?)', id, image.type, meta, chunks);
}

export async function readImage(id: string): Promise<StoredImage> {
  const head = sql.get<{ type: string }>('SELECT type FROM images WHERE id=?', id);
  if (!head) throw new Error('Imagem não encontrada.');
  const parts = sql.all<{ bytes: ArrayBuffer }>('SELECT bytes FROM image_chunks WHERE id=? ORDER BY seq', id);
  const out = new Uint8Array(parts.reduce((n, p) => n + p.bytes.byteLength, 0));
  let at = 0;
  for (const p of parts) {
    out.set(new Uint8Array(p.bytes), at);
    at += p.bytes.byteLength;
  }
  return { bytes: out, type: head.type };
}

export async function readImageMeta(id: string) {
  const row = sql.get<{ meta: string }>('SELECT meta FROM images WHERE id=?', id);
  if (!row) throw new Error('Imagem não encontrada.');
  return row.meta;
}

export async function writeImageMeta(id: string, meta: string) {
  db().exec('UPDATE images SET meta=? WHERE id=?', meta, id);
}

/** Arquivo gerado (PDF, CSV, foto, vídeo), em pedaços como as imagens. */
export async function putFile(id: string, bytes: Uint8Array, meta: string) {
  const chunks = Math.max(1, Math.ceil(bytes.length / CHUNK));
  db().exec('DELETE FROM file_chunks WHERE id=?', id);
  for (let i = 0; i < chunks; i++)
    db().exec('INSERT INTO file_chunks VALUES (?, ?, ?)', id, i, exact(bytes.subarray(i * CHUNK, (i + 1) * CHUNK)));
  db().exec('INSERT OR REPLACE INTO files VALUES (?, ?, ?)', id, meta, chunks);
}

export async function readFileBytes(id: string): Promise<Uint8Array> {
  if (!sql.get('SELECT id FROM files WHERE id=?', id)) throw new Error('Arquivo não encontrado.');
  const parts = sql.all<{ bytes: ArrayBuffer }>('SELECT bytes FROM file_chunks WHERE id=? ORDER BY seq', id);
  const out = new Uint8Array(parts.reduce((n, p) => n + p.bytes.byteLength, 0));
  let at = 0;
  for (const p of parts) {
    out.set(new Uint8Array(p.bytes), at);
    at += p.bytes.byteLength;
  }
  return out;
}

export async function readFileMeta(id: string) {
  const row = sql.get<{ meta: string }>('SELECT meta FROM files WHERE id=?', id);
  if (!row) throw new Error('Arquivo não encontrado.');
  return row.meta;
}

/**
 * Sem `sharp`, a foto vai como chegou: o navegador já a reduziu à área que a
 * classificação aceita (lib/shrink-image.ts).
 */
export async function jpegWithin(image: StoredImage, _maxPixels: number): Promise<StoredImage> {
  return image;
}

/**
 * Não há codificador JPEG no Worker. As fotos já chegam em JPEG do navegador e
 * as vistas do projeto são PNG, que o modo rápido também aceita.
 */
export async function toJpeg(image: StoredImage): Promise<StoredImage> {
  return image;
}

let resvgReady: Promise<void> | undefined;
export async function svgToPng(svg: string): Promise<Uint8Array> {
  resvgReady ??= initWasm(resvgWasm);
  await resvgReady;
  return new Resvg(svg).render().asPng();
}
