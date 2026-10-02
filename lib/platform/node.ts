import { DatabaseSync } from 'node:sqlite';
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import sharpModule from 'sharp';
import type { Sql, SqlValue, StoredImage, TraceSink } from './types';

export const PLATFORM = 'node' as const;

function dataDir() {
  return process.env.MERCE_DATA_DIR || join(process.cwd(), 'data');
}

let db: DatabaseSync | undefined;
let sql: Sql | undefined;
export function openDatabase(): Sql {
  if (sql) return sql;
  const dir = dataDir();
  mkdirSync(dir, { recursive: true });
  const d = new DatabaseSync(join(dir, 'merce.sqlite'));
  db = d;
  d.exec(
    'PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS projects (id TEXT PRIMARY KEY, body TEXT NOT NULL, version INTEGER NOT NULL, updated TEXT NOT NULL)',
  );
  // Cópia de segurança antes de cada migração de formato, uma vez só: v1/v2
  // para módulos (v3) e v3 para estilos (v4). A migração é na leitura e grava
  // no formato novo no próximo salvamento.
  for (const [below, file] of [
    [3, 'merce-before-modules.sqlite'],
    [4, 'merce-before-styles.sqlite'],
  ] as const) {
    const rows = d
      .prepare(
        `SELECT count(*) AS n FROM projects WHERE EXISTS (SELECT 1 FROM json_each(body, '$.revisions') r WHERE IFNULL(json_extract(r.value, '$.params.schemaVersion'), 0) < ${below})`,
      )
      .get() as { n: number };
    if (rows.n && !existsSync(join(dir, file))) d.exec(`VACUUM INTO '${join(dir, file).replaceAll("'", "''")}'`);
  }
  sql = {
    all: <T>(query: string, ...params: SqlValue[]) => d.prepare(query).all(...params) as T[],
    get: <T>(query: string, ...params: SqlValue[]) => d.prepare(query).get(...params) as T | undefined,
    run: (query: string, ...params: SqlValue[]) => ({ changes: Number(d.prepare(query).run(...params).changes) }),
  };
  return sql;
}

/** Cópia do banco inteiro num arquivo novo, na mesma pasta. Devolve o caminho. */
export function backupDatabase(name: string) {
  openDatabase();
  const file = join(dataDir(), name);
  if (existsSync(file)) throw new Error(`O backup ${file} já existe.`);
  db!.exec(`VACUUM INTO '${file.replaceAll("'", "''")}'`);
  return file;
}

function logsDir() {
  return join(dataDir(), 'logs');
}

/** `name` é `AAAA-MM-DD/HHMMSS-pedido`: vira `<data>/logs/<name>.jsonl`. */
export function traceSink(name: string): TraceSink | null {
  const dir = join(logsDir(), name.slice(0, 10));
  const file = join(logsDir(), `${name}.jsonl`);
  try {
    mkdirSync(dir, { recursive: true });
  } catch {
    return null;
  }
  // Síncrono de propósito: a linha fica no disco mesmo se o processo cair
  // logo depois, que é justamente quando o registro importa.
  return { file, append: (line) => appendFileSync(file, line) };
}

/** Apaga as pastas de dias anteriores a `oldest` (AAAA-MM-DD). */
export function pruneTraces(oldest: string) {
  const dir = logsDir();
  try {
    for (const name of readdirSync(dir))
      if (/^\d{4}-\d{2}-\d{2}$/.test(name) && name < oldest) rmSync(join(dir, name), { recursive: true, force: true });
  } catch {}
}

export function listTraces(limit: number) {
  const out: string[] = [];
  try {
    for (const day of readdirSync(logsDir()).filter((n) => /^\d{4}-\d{2}-\d{2}$/.test(n)).sort().reverse()) {
      for (const f of readdirSync(join(logsDir(), day)).filter((n) => n.endsWith('.jsonl')).sort().reverse()) {
        out.push(`${day}/${f.slice(0, -'.jsonl'.length)}`);
        if (out.length >= limit) return out;
      }
    }
  } catch {}
  return out;
}

export function readTrace(name: string) {
  if (!/^\d{4}-\d{2}-\d{2}\/[\w-]+$/.test(name)) return null;
  try {
    return readFileSync(join(logsDir(), `${name}.jsonl`), 'utf8');
  } catch {
    return null;
  }
}

type SharpSource = {
  metadata(): Promise<{ format?: string; pages?: number }>;
  rotate(): SharpSource;
  resize(options: { width: number; height: number; fit: 'inside'; withoutEnlargement: boolean }): SharpSource;
  jpeg(options?: { quality?: number }): SharpSource;
  webp(options: { quality: number }): SharpSource;
  png(options?: { compressionLevel?: number }): SharpSource;
  toBuffer(): Promise<Buffer>;
};
const sharp = sharpModule as unknown as (input: Buffer, options?: { limitInputPixels?: number }) => SharpSource;

/** Confere que é JPG, PNG ou WebP estático, gira pela EXIF, reduz a 1600 px e grava em WebP. */
export async function normalizeImage(bytes: Uint8Array): Promise<StoredImage> {
  const source = sharp(Buffer.from(bytes), { limitInputPixels: 25000000 });
  let metadata: { format?: string; pages?: number };
  try {
    metadata = await source.metadata();
  } catch {
    // O sharp devolve erro técnico em inglês para PDF e outros formatos.
    throw new Error('Use uma imagem estática JPG, PNG ou WebP.');
  }
  if (!['jpeg', 'png', 'webp'].includes(metadata.format || '') || (metadata.pages || 1) > 1)
    throw new Error('Use uma imagem estática JPG, PNG ou WebP.');
  const output = await source
    .rotate()
    .resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true })
    .webp({ quality: 85 })
    .toBuffer();
  return { bytes: output, type: 'image/webp' };
}

function imagesDir() {
  return join(dataDir(), 'images');
}

export async function putImage(id: string, image: StoredImage, meta: string) {
  await mkdir(imagesDir(), { recursive: true });
  await writeFile(join(imagesDir(), id + '.webp'), image.bytes);
  await writeFile(join(imagesDir(), id + '.json'), meta);
}

export async function readImage(id: string): Promise<StoredImage> {
  return { bytes: await readFile(join(imagesDir(), id + '.webp')), type: 'image/webp' };
}

export async function readImageMeta(id: string) {
  return readFile(join(imagesDir(), id + '.json'), 'utf8');
}

/** Alguns provedores (o modo rápido) não aceitam WebP. */
export async function toJpeg(image: StoredImage): Promise<StoredImage> {
  if (image.type === 'image/jpeg') return image;
  return { bytes: await sharp(Buffer.from(image.bytes)).jpeg({ quality: 85 }).toBuffer(), type: 'image/jpeg' };
}

export async function svgToPng(svg: string): Promise<Uint8Array> {
  return sharp(Buffer.from(svg), { limitInputPixels: 25000000 }).png({ compressionLevel: 9 }).toBuffer();
}
