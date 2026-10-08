import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { normalizeImage, putImage, readImage, readImageMeta, toJpeg, writeImageMeta } from '#platform';

export type ImageRef = { id: string; name: string; url: string };
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
export async function saveImage(bytes: Uint8Array, name: string): Promise<ImageRef> {
  if (!bytes.length || bytes.length > MAX_IMAGE_BYTES) throw new Error('A imagem deve ter até 10 MB.');
  const image = await normalizeImage(bytes);
  const id = randomUUID();
  const safeName = Array.from(name)
    .filter((character) => {
      const code = character.codePointAt(0) || 0;
      return code >= 32 && code !== 127;
    })
    .join('')
    .replaceAll('\\', '')
    .replaceAll('/', '')
    .slice(0, 120);
  const ref = { id, name: safeName || 'Referência', url: '/api/images?id=' + id };
  await putImage(id, image, JSON.stringify(ref));
  return ref;
}
/** Bytes e tipo da imagem guardada (WebP no Node; JPEG, PNG ou WebP na Cloudflare). */
export async function imageFile(id: string) {
  return readImage(z.uuid().parse(id));
}
export async function imageBytes(id: string) {
  return Buffer.from((await imageFile(id)).bytes);
}
export async function getImage(id: string): Promise<ImageRef> {
  z.uuid().parse(id);
  try {
    // A metadata guarda também a classificação (lib/photo-classify.ts); a
    // referência que vai para a conversa fica só com o que identifica a foto.
    const meta = JSON.parse(await readImageMeta(id)) as ImageRef;
    return { id: meta.id, name: meta.name, url: meta.url };
  } catch {
    throw new Error('Imagem não encontrada.');
  }
}
/** Metadata guardada da imagem, em JSON (ImageRef e o que mais foi anotado nela). */
export async function readStoredMeta(id: string) {
  return readImageMeta(z.uuid().parse(id));
}
export async function writeStoredMeta(id: string, meta: string) {
  await writeImageMeta(z.uuid().parse(id), meta);
}
export async function imageDataUrl(id: string, format: 'webp' | 'jpeg' = 'webp') {
  const stored = await imageFile(id);
  const image = format === 'jpeg' ? await toJpeg(stored) : stored;
  return `data:${image.type};base64,` + Buffer.from(image.bytes).toString('base64');
}
