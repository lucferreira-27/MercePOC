import type { z } from 'zod';
import type { Prices } from '../quote';
import type { AgentContext } from './context';

/**
 * Tipos do assistente em laço: ferramentas tipadas, efeitos na interface e os
 * passos que a conversa mostra. Nada aqui lê segredo nem banco: o cliente
 * importa os mesmos tipos para aplicar os efeitos.
 */
export const VIEW_MODES = ['perspective', 'front', 'side', 'top'] as const;
export type ViewModeName = (typeof VIEW_MODES)[number];
export const UI_TABS = ['project', 'room', 'quote', 'cut', 'parts', 'history'] as const;
export type UiTab = (typeof UI_TABS)[number];
export const EXPORT_KINDS = ['pdf', 'png', 'parts-csv', 'cut-csv', 'cortecloud', 'json', 'quote-pdf', 'video'] as const;
export type ExportKind = (typeof EXPORT_KINDS)[number];

/**
 * Efeito na interface: o que só o navegador faz (câmera, abas, arquivos,
 * preços guardados no navegador). O servidor decide, a página executa.
 * `live` sai durante o turno; os demais esperam o projeto novo chegar, para
 * seleção, frentes e arquivos valerem sobre a versão salva.
 */
export type Effect =
  | { type: 'camera'; mode: ViewModeName }
  | { type: 'frame' }
  | { type: 'toggle'; what: 'explode' | 'dims' | 'room'; on: boolean }
  | { type: 'tab'; tab: UiTab }
  | { type: 'prices'; prices: Prices }
  | { type: 'export'; kind: ExportKind };
export const LIVE_EFFECTS: readonly Effect['type'][] = ['camera', 'frame', 'toggle', 'tab'];

/**
 * Uma opção montada para comparar (options_make): o design inteiro, para o
 * cartão desenhar e aplicar, e os números que o código calcula.
 */
export type OptionCard = {
  id: string;
  name: string;
  brief: string;
  params: unknown;
  total: number;
  sheets: number;
  parts: number;
  doors: number;
  drawers: number;
  /** Largura, altura e profundidade totais, em mm. */
  size: [number, number, number];
  /** Cabe no ambiente (null: sem ambiente). */
  fits: boolean | null;
  /** Uma frase da IA sobre o que a opção tem. */
  note: string;
};

/** O que a pessoa está vendo agora: a IA não muda o que já está como ela quer. */
export type UiState = {
  view: ViewModeName;
  tab: UiTab;
  exploded: boolean;
  dims: boolean;
  room: boolean;
  /** Grupos de frente abertos (ids de movimento). */
  open: string[];
};

/** Uma ferramenta chamada no turno, como a conversa conta. */
export type AgentStep = {
  tool: string;
  label: string;
  ok: boolean;
  detail?: string;
};

export type ToolResult = {
  ok: boolean;
  /** Texto que volta para a IA: curto, factual, com os ids reais. */
  text: string;
  /** Frase da etapa para a pessoa ("Montei 3 balcões"). */
  label?: string;
  /** Imagem para a IA ver (data URL): vai numa mensagem logo depois dos resultados. */
  image?: string;
};

export type Tool<A = unknown> = {
  name: string;
  /** Uma ou duas frases para a IA: quando usar e o que devolve. */
  description: string;
  args: z.ZodType<A>;
  /** Etapa que aparece enquanto roda. */
  running?: (args: A) => string;
  run: (ctx: AgentContext, args: A) => ToolResult | Promise<ToolResult>;
};

/** Eventos do turno para a transmissão ao vivo. */
export type AgentEvent =
  | { type: 'step'; step: AgentStep; index: number }
  | { type: 'running'; tool: string; label: string; index: number }
  | { type: 'effect'; effect: Effect }
  | { type: 'draft'; params: unknown; room: unknown }
  | { type: 'plan'; steps: string[] }
  | { type: 'say'; text: string };
