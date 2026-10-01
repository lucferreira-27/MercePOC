import { generateComposition, type Composition } from './composition';
import { assets, buildAsset, introOf, resolveInput, type Asset, type AssetCategory } from './assets';
import type { StyleId } from './look';
import type { Room } from './room';

/**
 * Pontos de partida prontos: cada ativo da biblioteca, nas medidas padrão,
 * vira um modelo de projeto novo. O que sai daqui passou pela mesma validação
 * de qualquer edição, e o histórico começa limpo com o modelo como versão 1.
 */
export type Template = {
  id: string;
  name: string;
  summary: string;
  category: AssetCategory;
  /** Texto de boas-vindas: o que foi montado e por onde continuar. */
  intro: string;
  /** Ambiente de exemplo (parede, TV, porta) para dar escala e encaixe. */
  room?: Room;
  asset: Asset;
};

export const templates: Template[] = assets.map((asset) => {
  const input = resolveInput(asset);
  return {
    id: asset.id,
    name: asset.name,
    summary: asset.summary,
    category: asset.category,
    intro: asset.intro(input),
    room: asset.room?.(input, input.width),
    asset,
  };
});

export function templateById(id: string) {
  return templates.find((t) => t.id === id);
}

/** Aplica o modelo no motor (no estilo, se pedido) e devolve a composição validada. */
export function buildTemplate(t: Template, style?: StyleId): Composition {
  return buildAsset(t.asset, style ? { style } : {});
}

/**
 * Boas-vindas e ambiente do modelo no estilo: as medidas mudam com a
 * proporção, e o ambiente centra pela largura de verdade do móvel montado
 * (a moldura e o tampo do estilo avançam para os lados).
 */
export function templateStart(t: Template, style: StyleId | undefined, design: Composition): { intro: string; room?: Room } {
  if (!style) return { intro: t.intro, ...(t.room ? { room: t.room } : {}) };
  const input = resolveInput(t.asset, { style });
  const b = generateComposition(design).bounds;
  const room = t.asset.room?.(input, b.max[0] - b.min[0]);
  return { intro: introOf(t.asset, input), ...(room ? { room } : {}) };
}
