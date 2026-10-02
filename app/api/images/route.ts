import { saveImage, imageFile, MAX_IMAGE_BYTES } from '@/lib/images';
import { sameOrigin } from '@/lib/utils';
export async function POST(req: Request) {
  try {
    if (!sameOrigin(req)) return Response.json({ error: 'Origem inválida' }, { status: 403 });
    if (Number(req.headers.get('content-length')) > MAX_IMAGE_BYTES + 65536) throw new Error('A imagem deve ter até 10 MB.');
    const reader = req.body?.getReader();
    if (!reader) throw new Error('Selecione uma imagem.');
    const chunks: Uint8Array[] = [];
    let total = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.length;
        if (total > MAX_IMAGE_BYTES + 65536) { await reader.cancel(); throw new Error('A imagem deve ter até 10 MB.'); }
        chunks.push(value);
      }
    } finally { reader.releaseLock(); }
    const form = await new Response(Buffer.concat(chunks), { headers: { 'Content-Type': req.headers.get('content-type') || '' } }).formData();
    const file = form.get('image');
    if (!(file instanceof File)) throw new Error('Selecione uma imagem.');
    return Response.json(await saveImage(Buffer.from(await file.arrayBuffer()), file.name));
  } catch (e) { return Response.json({ error: e instanceof Error ? e.message : 'Imagem inválida.' }, { status: 400 }); }
}
export async function GET(req: Request) {
  try {
    const image = await imageFile(new URL(req.url).searchParams.get('id') || '');
    return new Response(new Uint8Array(image.bytes), { headers: { 'Content-Type': image.type, 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'private, max-age=86400' } });
  } catch { return new Response('Imagem não encontrada.', { status: 404 }); }
}
