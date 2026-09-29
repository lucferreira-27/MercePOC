/**
 * Reduz a foto no navegador antes de enviar: lado maior de até 1600 px, em
 * JPEG. O celular manda fotos de 5 a 10 MB; reduzidas elas sobem rápido e
 * servem para qualquer provedor (o modo rápido não aceita WebP). Na Cloudflare
 * não há `sharp`, então esta é a única redução que a foto recebe. Se o
 * navegador não conseguir decodificar, a original segue e o servidor decide.
 */
const MAX_SIDE = 1600;

export async function shrinkImage(file: File): Promise<File> {
  if (typeof createImageBitmap !== 'function') return file;
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    return file;
  }
  try {
    const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const g = canvas.getContext('2d');
    if (!g) return file;
    // PNG com transparência: fundo branco, como papel, em vez de preto.
    g.fillStyle = '#fff';
    g.fillRect(0, 0, width, height);
    g.drawImage(bitmap, 0, 0, width, height);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.85));
    if (!blob) return file;
    // O nome fica o original: é o que a conversa mostra e o que evita anexar a mesma foto duas vezes.
    return new File([blob], file.name, { type: 'image/jpeg' });
  } finally {
    bitmap.close();
  }
}
