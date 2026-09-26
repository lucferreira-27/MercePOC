import { revise, reviseRoom, save, get, type Project } from '../store';
import type { Design, ShelfOp } from '../studio';
import type { Room } from '../room';
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
  /** Operações aplicadas desde a última gravação, em ordem. */
  ops: ShelfOp[] = [];
  /** Todas as operações do pedido, para o resumo e a animação da mudança. */
  allOps: ShelfOp[] = [];
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
    this.design = design;
    this.ops.push(...ops);
    this.allOps.push(...ops);
    this.emit({ type: 'draft', params: design, room: this.room ?? null });
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
    } else if (this.roomChanged && this.room) {
      discarded = reviseRoom(this.project, this.room, label).discarded;
    }
    this.rebase();
    return discarded;
  }

  /** Recomeça do que está gravado agora (depois de gravar ou navegar). */
  rebase() {
    this.design = this.base;
    this.start = this.design;
    this.room = this.project.room;
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
