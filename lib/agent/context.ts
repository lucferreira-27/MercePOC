import { createHash } from 'node:crypto';
import { revise, reviseRoom, save, get, type Project } from '../store';
import { canonical, type Design, type ShelfOp } from '../studio';
import { generateComposition } from '../composition';
import { wallAt, type Room } from '../room';
import type { Prices } from '../quote';
import type { AgentEvent, AgentStep, Effect, OptionCard, UiState } from './types';
import type { JevAnswer } from './jev';

/**
 * Rascunho do turno. A IA age sobre uma cópia do projeto: cada lote de
 * operações é validado na hora e, se passa, vira o novo rascunho (a cena
 * mostra ao vivo). A versão nova só nasce no fim, uma por pedido, então um
 * Ctrl+Z desfaz o trabalho inteiro.
 *
 * Ferramentas que mudam de versão ou de projeto (voltar versão, criar
 * alternativa, projeto novo) gravam o rascunho antes e recomeçam dali.
 */
export class AgentContext {
  project: Project;
  /** Versão do registro no banco, para a gravação otimista. */
  version: number;
  design: Design;
  room: Room | undefined;
  prices: Prices;
  /** Operações do trecho atual do rascunho (desde a última gravação ou volta), em ordem. */
  ops: ShelfOp[] = [];
  /** Operações de trechos já gravados neste pedido. */
  kept: ShelfOp[] = [];
  /**
   * Operações que chegaram ao rascunho e saíram dele: rascunho descartado
   * (history_undo no meio do pedido) ou desfeito no fim (tempo acabou com o
   * rascunho inválido). Não entram no registro do que ficou.
   */
  reverted: ShelfOp[] = [];
  /** Lotes recusados pela validação: nunca chegaram ao rascunho. */
  attempted: { ops: ShelfOp[]; error: string }[] = [];
  /**
   * Estado do rascunho em que cada leitura foi feita (orçamento, plano de
   * corte, desenho). Mudou o rascunho, a leitura ficou velha: a resposta não
   * pode citar número dela sem ler de novo.
   */
  evidence: Partial<Record<'quote' | 'cut' | 'look' | 'parts', string>> = {};
  /** A conferência do finish já rodou sobre o rascunho final. */
  checked = false;
  /** Design de partida do trecho atual (muda depois de gravar ou navegar). */
  start: Design;
  effects: Effect[] = [];
  steps: AgentStep[] = [];
  plan: string[] = [];
  /** Seleção pedida pela IA (ids vivos) e frentes a abrir ou fechar. */
  select: string[] | null = null;
  fronts: { ids: string[]; open: boolean } | null = null;
  finish: { message: string; suggestions: string[] } | null = null;
  ask: { question: string; options: { id: string; label: string; partIds: string[] }[] } | null = null;
  /** Opções montadas para comparar; a resposta leva o cartão. */
  options: OptionCard[] | null = null;
  /**
   * Roda um sub-laço num rascunho filho (opções): o turno liga, porque só ele
   * sabe o modelo, o sinal e o provedor.
   */
  runner: ((sub: AgentContext, request: string) => Promise<unknown>) | null = null;
  /** O que o pedido quer (Jev), perguntado no começo e conferido no finish. */
  wants: Promise<Record<string, JevAnswer> | null> | null = null;
  /** Conferências que já voltaram para a IA corrigir. */
  repairs = 0;
  /** O portão do perguntar já conferiu uma pergunta: a próxima segue direto. */
  askGated = false;
  /** Ações escolhidas pelo roteador (Jev leu o pedido), não pela IA. */
  direct = false;
  /** Houve troca de versão (desfazer, voltar) no meio do turno. */
  navigated = false;
  /** Projeto de onde o turno saiu, quando abriu outro (alternativa, novo). */
  origin: { project: Project; version: number } | null = null;
  /** Rótulo da versão que o turno grava. */
  readonly label: string;
  /** Como o projeto estava no começo do pedido: a conferência compara com ele. */
  turnStart: { design: Design; room: Room | undefined };

  constructor(
    project: Project,
    version: number,
    prices: Prices,
    readonly request: string,
    readonly selected: string[],
    readonly ui: UiState | null,
    readonly emit: (event: AgentEvent) => void = () => {},
  ) {
    this.project = project;
    this.version = version;
    this.prices = prices;
    this.design = project.revisions[project.cursor].params;
    this.start = this.design;
    this.room = project.room;
    this.label = request.trim().slice(0, 90) || 'Pedido à IA';
    this.turnStart = { design: this.design, room: this.room };
  }

  /** Operações que o rascunho atual carrega desde o começo do pedido, em ordem. */
  get allOps(): ShelfOp[] {
    return [...this.kept, ...this.ops];
  }
  /** Impressão do rascunho (móvel e ambiente): liga cada leitura ao estado lido. */
  stateKey() {
    return createHash('sha1')
      .update(JSON.stringify([canonical(this.design), this.room ?? null]))
      .digest('hex')
      .slice(0, 16);
  }
  /** Registra que a leitura `kind` foi feita sobre o rascunho de agora. */
  note(kind: keyof AgentContext['evidence']) {
    this.evidence[kind] = this.stateKey();
  }
  /** A leitura `kind` ainda descreve o rascunho de agora. */
  fresh(kind: keyof AgentContext['evidence']) {
    return this.evidence[kind] === this.stateKey();
  }

  get base(): Design {
    return this.project.revisions[this.project.cursor].params;
  }
  get designChanged() {
    return JSON.stringify(this.design) !== JSON.stringify(this.base);
  }
  get roomChanged() {
    return JSON.stringify(this.room ?? null) !== JSON.stringify(this.project.room ?? null);
  }

  /** Aceita um design já validado e mostra na cena. */
  setDesign(design: Design, ops: ShelfOp[]) {
    this.pinWall(design);
    this.design = design;
    this.ops.push(...ops);
    this.emit({ type: 'draft', params: design, room: this.room ?? null });
  }

  /**
   * Parede presa quando o pedido muda o móvel e algo do começo fica no
   * lugar. Sem âncora a parede acompanha o lado esquerdo e o fundo do
   * conjunto: um nicho novo à esquerda do painel arrastava a parede, e a TV
   * com ela, para fora do painel. Na troca do móvel inteiro (nada do começo
   * fica) a parede segue o móvel novo, como antes.
   */
  private pinWall(next: Design) {
    const room = this.room;
    if (!room || room.anchor) return;
    const start = this.turnStart.design;
    const stays = next.modules.some((m) => {
      const s = start.modules.find((v) => v.id === m.id);
      return !!s && s.rotation === m.rotation && s.position.every((v, i) => Math.abs(v - m.position[i]) < 0.01);
    });
    if (!stays) return;
    const was = wallAt(room, generateComposition(canonical(start), false).bounds);
    const now = wallAt(room, generateComposition(canonical(next), false).bounds);
    if (Math.abs(was.x - now.x) < 0.01 && Math.abs(was.z - now.z) < 0.01) return;
    this.room = { ...room, anchor: { x: was.x, z: was.z } };
  }
  setRoom(room: Room | undefined) {
    this.room = room;
    this.emit({ type: 'draft', params: this.design, room: room ?? null });
  }

  /** Grava o rascunho como versão (quando mudou). Devolve versões descartadas. */
  commit(label = this.label) {
    let discarded = 0;
    if (this.designChanged) {
      this.project.room = this.room;
      discarded = revise(this.project, this.design, label);
      this.kept.push(...this.ops);
    } else {
      // Operações que se anularam (pôs e tirou) não deixam nada gravado.
      this.reverted.push(...this.ops);
      if (this.roomChanged && this.room) discarded = reviseRoom(this.project, this.room, label).discarded;
    }
    this.ops = [];
    this.rebase();
    return discarded;
  }

  /** Descarta o rascunho: volta ao que está gravado e guarda as operações como desfeitas. */
  discard() {
    this.rebase();
  }

  /** Recomeça do que está gravado agora (depois de gravar ou navegar). */
  rebase() {
    this.design = this.base;
    this.start = this.design;
    this.room = this.project.room;
    // O que não foi gravado antes de voltar sai do rascunho: fica como desfeito.
    this.reverted.push(...this.ops);
    this.ops = [];
  }

  /** Grava no banco: antes de outra rotina ler o projeto de lá. */
  persist() {
    const state = save(this.project, this.version);
    this.version = state.version;
  }

  /** Passa a editar outro projeto (alternativa ou novo), guardando o de origem. */
  switchTo(id: string) {
    this.origin ??= { project: this.project, version: this.version };
    this.project = get(id);
    this.version = this.project.version;
    this.rebase();
    this.turnStart = { design: this.design, room: this.room };
  }

  /**
   * Rascunho filho para uma opção: parte do rascunho atual, mesmo projeto e
   * preços, sem gravar nada. Só ferramentas de desenho e leitura rodam nele.
   */
  child(): AgentContext {
    const sub = new AgentContext(this.project, this.version, this.prices, this.request, [], this.ui);
    sub.design = this.design;
    sub.start = this.design;
    sub.room = this.room;
    sub.turnStart = { design: this.design, room: this.room };
    // Sem rodadas de conferência: o cartão mostra encaixe e números do código,
    // e três opções com reparos triplicariam o tempo.
    sub.repairs = 2;
    return sub;
  }

  effect(e: Effect) {
    // O mesmo efeito duas vezes (dois PDFs, duas vistas) vale uma: fica o último.
    const key = effectKey(e);
    this.effects = this.effects.filter((v) => effectKey(v) !== key);
    this.effects.push(e);
    this.emit({ type: 'effect', effect: e });
  }
}

/** Efeitos do mesmo tipo e alvo se substituem: uma vista, um arquivo de cada formato. */
function effectKey(e: Effect) {
  if (e.type === 'export') return `export:${e.kind}`;
  if (e.type === 'toggle') return `toggle:${e.what}`;
  return e.type;
}
