import sharpModule from 'sharp';
import type { ModularPart } from './composition';
import { planSvg } from './plan-geometry';
export * from './plan-geometry';

/**
 * O `sharp` chega sem tipos utilizáveis neste projeto (o `lib/images.ts` já
 * declara a forma mínima que usa). Aqui só é preciso rasterizar SVG em PNG.
 */
type SharpSource = {
  png(options?: { compressionLevel?: number }): SharpSource;
  toBuffer(): Promise<Buffer>;
};
const sharp = sharpModule as unknown as (input: Buffer, options?: { limitInputPixels?: number }) => SharpSource;

/**
 * Vista do projeto para a IA olhar o próprio resultado.
 *
 * O servidor não tem WebGL (o `three` do app roda no navegador), e a leitura
 * que interessa aqui não é material nem luz: é proporção, cheios e vazios,
 * quantos corpos e onde estão as gavetas. Duas vistas numa imagem só, porque
 * cada uma responde a uma pergunta: a frontal mostra a divisão dos vãos
 * (comparável com uma foto de frente) e a isométrica mostra profundidade,
 * encaixe no canto e o que fica na frente do quê.
 *
 * O desenho é SVG puro, rasterizado com o `sharp` que já está no projeto. Nada
 * de tela: a mesma peça que a IA recebe também pode ser salva e olhada por uma
 * pessoa.
 */

export async function planPng(parts: readonly ModularPart[]): Promise<Buffer> {
  return sharp(Buffer.from(planSvg(parts)), { limitInputPixels: 25000000 })
    .png({ compressionLevel: 9 })
    .toBuffer();
}

/** O mesmo PNG como data URL, que é o formato que o provedor aceita. */
export async function planDataUrl(parts: readonly ModularPart[]): Promise<string> {
  return 'data:image/png;base64,' + (await planPng(parts)).toString('base64');
}
