import type { Composition } from './composition';
import { assets, buildAsset, resolveInput, type Asset, type AssetCategory } from './assets';
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

/** Aplica o modelo no motor e devolve a composição validada. */
export function buildTemplate(t: Template): Composition {
  return buildAsset(t.asset);
}
