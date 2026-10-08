import { z } from 'zod';
import { classificationChips, imageClassification } from '@/lib/photo-classify';
import { sameOrigin } from '@/lib/utils';

/**
 * Classifica a foto logo depois do envio, enquanto a pessoa escreve o pedido.
 * O resultado fica gravado com a imagem; o turno que chega antes do fim espera
 * a mesma chamada. Sem chave ou com falha devolve `chips: []` e nada muda.
 */
export async function POST(req: Request) {
  if (!sameOrigin(req)) return Response.json({ error: 'Origem inválida' }, { status: 403 });
  let id: string;
  try {
    id = z.object({ id: z.uuid() }).parse(await req.json()).id;
  } catch {
    return Response.json({ error: 'Imagem inválida.' }, { status: 400 });
  }
  const classification = await imageClassification(id);
  return Response.json({ chips: classificationChips(classification) });
}
