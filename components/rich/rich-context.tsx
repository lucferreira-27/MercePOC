'use client';
import { createContext, useContext, useEffect, useState } from 'react';
import type { CutPlan } from '@/lib/cutplan';
import type { ModularPart } from '@/lib/composition';
import type { Quote, QuoteAdjust } from '@/lib/quote';
import type { FileBlock, FileFormat, FileMeta } from '@/lib/rich';

/**
 * O que os cartões da conversa enxergam do estúdio. A página monta este
 * objeto com os mesmos dados e as mesmas ações das abas: o cartão nunca tem
 * cópia própria do orçamento ou do plano de corte, só lê e pede.
 */
export type RichMode = 'split' | 'chat' | 'app';

/** O que abre em tela grande (aba do estúdio, cena 3D ou prévia de arquivo). */
export type PanelTarget =
  | { kind: 'quote'; focus?: string[] }
  | { kind: 'cut'; sheet?: number }
  | { kind: 'scene' }
  | { kind: 'project' }
  | { kind: 'parts' }
  | { kind: 'room' }
  | { kind: 'history' }
  | { kind: 'file'; block: FileBlock; meta: FileMeta };

/** Rascunho do orçamento: ajustes ainda não gravados, sobre uma versão. */
export type QuoteDraft = { revisionId: string; adjust: QuoteAdjust | undefined; changes: number };

export type RichApi = {
  projectId: string;
  projectName: string;
  mode: RichMode;
  busy: boolean;
  /** Versão vigente do projeto. */
  current: { id: string; number: number; index: number };
  /**
   * O cartão segue a versão vigente? O mais novo de cada tipo na conversa,
   * sim (editar por ele, pela aba ou por outro pedido atualiza o cartão); os
   * anteriores do mesmo tipo ficam como histórico da versão em que saíram.
   */
  isLive: (block: { id: string; widget: string }) => boolean;
  /** Lugar da cena viva no cartão do móvel (ref de callback). */
  sceneSlot: (el: HTMLElement | null) => void;
  /** Controles da cena viva, os mesmos da barra da cena. */
  scene: {
    view: 'perspective' | 'front' | 'side' | 'top';
    setView: (v: 'perspective' | 'front' | 'side' | 'top') => void;
    zoom: (direction: 'in' | 'out') => void;
    frame: () => void;
    dims: boolean;
    toggleDims: () => void;
    exploded: boolean;
    toggleExplode: () => void;
    fronts: boolean;
    canFronts: boolean;
    toggleFronts: () => void;
    /** A pessoa clicou na cena: a roda do mouse aproxima. */
    active: boolean;
    setActive: (on: boolean) => void;
  };
  /** Índice da versão no caminho atual; -1 quando ela foi descartada. */
  revisionIndex: (id: string) => number;
  /** Número exibido de uma versão viva. */
  revisionNumber: (index: number) => number;
  /** Orçamento de uma versão, com a tabela de preços deste navegador e os ajustes dela. */
  quoteAt: (index: number) => Quote;
  /** Plano de corte de uma versão. */
  planAt: (index: number) => CutPlan;
  /** Peças do desenho de uma versão (miniatura do móvel). */
  drawingAt: (index: number) => readonly ModularPart[];
  modulesAt: (index: number) => number;
  partsAt: (index: number) => number;
  /** Medidas totais de uma versão, em mm. */
  sizeAt: (index: number) => [number, number, number];
  /** Ajuste do orçamento gravado na versão vigente. */
  savedAdjust: QuoteAdjust | undefined;
  draft: QuoteDraft | null;
  /** O orçamento do rascunho (a versão vigente com os ajustes não gravados). */
  draftQuote: Quote | null;
  setDraft: (adjust: QuoteAdjust | undefined) => void;
  /** Rascunho guardado de outra versão (o projeto mudou antes de gravar). */
  staleDraft: { revision: number | null; changes: number } | null;
  /** Traz o rascunho guardado para a versão vigente, para revisar e salvar. */
  adoptDraft: () => void;
  discardDraft: () => void;
  saveDraft: () => Promise<void>;
  /** Abre a aba (modo dividido) ou a janela grande (só conversa, app). */
  open: (target: PanelTarget, opener: HTMLElement | null) => void;
  /** Gera um arquivo do servidor numa mensagem nova. */
  generate: (format: FileFormat, revisionId?: string) => Promise<void>;
  /** Formatos sendo gerados agora por um cartão. */
  generating: readonly FileFormat[];
  /** O navegador grava a foto ou o vídeo pendente de um cartão. */
  fulfill: (messageId: string, block: FileBlock) => void;
  /** Blocos que o navegador está gravando agora (ids). */
  fulfilling: readonly string[];
  selected: readonly string[];
  selectParts: (ids: string[], extend: boolean) => void;
  /** Acende peças no móvel (chapa ou peça sob o cursor). */
  focusParts: (focus: { ids: string[]; mode: 'sheet' | 'piece' } | null) => void;
  seek: (index: number) => void;
  downloadCutCsv: (index: number) => void;
  /** Bloco mais novo do mesmo formato que substitui este arquivo. */
  supersededBy: (fileId: string) => FileBlock | null;
  scrollToBlock: (blockId: string) => void;
};

export const RichContext = createContext<RichApi | null>(null);

export function useRich() {
  const api = useContext(RichContext);
  if (!api) throw new Error('Cartão fora da conversa.');
  return api;
}

export function fileUrl(id: string, download = false) {
  return `/api/files?id=${encodeURIComponent(id)}${download ? '&download=1' : ''}`;
}

/**
 * O arquivo ainda está no servidor? O cartão pergunta uma vez por id (a
 * metadata é pequena) e mostra "indisponível" se ele sumiu.
 */
const known = new Map<string, Promise<boolean>>();
export function useFileAvailable(id: string | undefined) {
  const [state, setState] = useState<'checking' | 'ok' | 'missing'>('checking');
  useEffect(() => {
    if (!id) return;
    let alive = true;
    let check = known.get(id);
    if (!check) {
      check = fetch(`/api/files?id=${encodeURIComponent(id)}&meta=1`)
        .then((r) => r.ok)
        .catch(() => false);
      known.set(id, check);
    }
    void check.then((ok) => alive && setState(ok ? 'ok' : 'missing'));
    return () => {
      alive = false;
    };
  }, [id]);
  return id ? state : 'missing';
}

/** Páginas em SVG da prévia (PDF), lidas uma vez por arquivo. */
const pages = new Map<string, Promise<string[] | null>>();
export function usePreviewPages(previewId: string | undefined) {
  const [state, setState] = useState<string[] | null | undefined>(undefined);
  useEffect(() => {
    if (!previewId) return;
    let alive = true;
    let load = pages.get(previewId);
    if (!load) {
      load = fetch(fileUrl(previewId))
        .then((r) => (r.ok ? (r.json() as Promise<string[]>) : null))
        .catch(() => null);
      pages.set(previewId, load);
    }
    void load.then((v) => alive && setState(v));
    return () => {
      alive = false;
    };
  }, [previewId]);
  return previewId ? state : null;
}

/** Data URL de um SVG: a prévia vai como imagem, sem script nem estilo da página. */
export function svgUrl(svg: string) {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

/**
 * WebM gravado pelo navegador (MediaRecorder) não traz a duração no
 * cabeçalho: a barra do tocador fica sem fim. Pular para o fim força o
 * navegador a medir; depois volta ao começo.
 */
export function fixDuration(e: React.SyntheticEvent<HTMLMediaElement>) {
  const media = e.currentTarget;
  if (Number.isFinite(media.duration)) return;
  const back = () => {
    media.removeEventListener('timeupdate', back);
    media.currentTime = 0;
  };
  media.addEventListener('timeupdate', back);
  media.currentTime = 1e101;
}
