import sharpModule from 'sharp';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';

export type ImageRef = { id: string; name: string; url: string };
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
type SharpSource = {
  metadata(): Promise<{ format?: string; pages?: number }>;
  rotate(): SharpSource;
  resize(options: { width: number; height: number; fit: 'inside'; withoutEnlargement: boolean }): SharpSource;
  jpeg(options?: { quality?: number }): SharpSource;
  webp(options: { quality: number }): SharpSource;
  toBuffer(): Promise<Buffer>;
};
const sharp = sharpModule as unknown as (input: Buffer, options?: { limitInputPixels?: number }) => SharpSource;
function directory() {
  return join(process.env.MERCE_DATA_DIR || join(process.cwd(), 'data'), 'images');
}
function path(id: string) { return join(directory(), z.uuid().parse(id) + '.webp'); }
export async function saveImage(bytes: Buffer, name: string): Promise<ImageRef> {
  if (!bytes.length || bytes.length > MAX_IMAGE_BYTES) throw new Error('A imagem deve ter até 10 MB.');
  const source = sharp(bytes, { limitInputPixels: 25000000 });
  const metadata = await source.metadata();
  if (!['jpeg', 'png', 'webp'].includes(metadata.format || '') || (metadata.pages || 1) > 1)
    throw new Error('Use uma imagem estática JPG, PNG ou WebP.');
  const output = await source.rotate().resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true }).webp({ quality: 85 }).toBuffer();
  const id = randomUUID();
  await mkdir(directory(), { recursive: true });
  await writeFile(path(id), output);
  const safeName = Array.from(name)
    .filter((character) => {
      const code = character.codePointAt(0) || 0;
      return code >= 32 && code !== 127;
    })
    .join('')
    .replaceAll('\\', '')
    .replaceAll('/', '')
    .slice(0, 120);
  const image = { id, name: safeName || 'Referência', url: '/api/images?id=' + id };
  await writeFile(join(directory(), id + '.json'), JSON.stringify(image));
  return image;
}
export async function imageBytes(id: string) { return readFile(path(id)); }
export async function getImage(id: string): Promise<ImageRef> {
  z.uuid().parse(id);
  try {
    return JSON.parse(await readFile(join(directory(), id + '.json'), 'utf8')) as ImageRef;
  } catch {
    throw new Error('Imagem não encontrada.');
  }
}
export async function imageDataUrl(id: string, format: 'webp' | 'jpeg' = 'webp') {
  if (format === 'webp')
    return 'data:image/webp;base64,' + (await imageBytes(id)).toString('base64');
  const jpeg = await sharp(await imageBytes(id)).jpeg({ quality: 85 }).toBuffer();
  return 'data:image/jpeg;base64,' + jpeg.toString('base64');
}
