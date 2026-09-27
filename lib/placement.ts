/**
 * Mudar o móvel de lugar sem encher o histórico. Arrastar, as setas e girar
 * seguidos no mesmo conjunto viram uma versão só; cada movimento fica como um
 * passo dentro dela, e desfazer/refazer anda passo a passo antes de trocar de
 * versão. Sem dependências de servidor: a página usa as mesmas regras para
 * saber se Desfazer e Refazer estão disponíveis.
 */
export type Vec3 = [number, number, number];
/**
 * Onde a raiz do conjunto estava: é só isso que um movimento muda. Numa
 * parede do ambiente, o ajuste também muda a medida: `size` guarda
 * comprimento e altura.
 */
export type PlacementStep = { position: Vec3; rotation: number; size?: [number, number] };
export type Placement = {
  /** Módulo raiz que os movimentos desta versão mexem (ou o obstáculo, ou a parede). */
  root: string;
  /**
   * Sequência de arrastos de um obstáculo da parede: `root` é o id dele e o
   * passo guarda x e y em `position` (z e giro ficam 0).
   */
  obstacle?: true;
  /**
   * Sequência de ajustes de uma parede do ambiente (arrasto, alças, giro):
   * `root` é o id dela; o passo guarda x e z em `position`, o giro e a medida.
   */
  wall?: true;
  /** Último movimento, para saber se o próximo ainda é da mesma sequência. */
  at: string;
  /** Lugares anteriores, do mais antigo ao mais recente: Desfazer tira do fim. */
  back: PlacementStep[];
  /** Lugares desfeitos: Refazer tira do fim. */
  ahead: PlacementStep[];
};

/** Um movimento parado por mais que isto começa uma versão nova. */
export const PLACEMENT_MERGE_MS = 2 * 60_000;
/** Passos guardados por versão: o suficiente para voltar, sem crescer à toa. */
export const PLACEMENT_MAX_STEPS = 50;

type EditOp = { kind: string; id?: string; [key: string]: unknown };

/** O pedido é só um movimento (posição e/ou giro de um módulo)? */
export function placementRoot(ops: readonly EditOp[]): string | null {
  if (ops.length !== 1) return null;
  const [op] = ops;
  if (op.kind !== 'module.edit' || typeof op.id !== 'string') return null;
  const keys = Object.keys(op).filter((k) => op[k] !== undefined);
  const moves = keys.some((k) => k === 'position' || k === 'rotation');
  return moves && keys.every((k) => ['kind', 'id', 'position', 'rotation'].includes(k)) ? op.id : null;
}

type WithRevisions = {
  cursor: number;
  revisions: { placement?: Placement }[];
};
/** Passos desta versão só valem na ponta do histórico. */
function tipPlacement(p: WithRevisions) {
  return p.cursor === p.revisions.length - 1 ? p.revisions[p.cursor]?.placement : undefined;
}
export function canUndo(p: WithRevisions) {
  return p.cursor > 0 || !!tipPlacement(p)?.back.length;
}
export function canRedo(p: WithRevisions) {
  return p.cursor < p.revisions.length - 1 || !!tipPlacement(p)?.ahead.length;
}
/** O próximo Desfazer volta um movimento, não uma versão. */
export function undoIsStep(p: WithRevisions) {
  return !!tipPlacement(p)?.back.length;
}
export function redoIsStep(p: WithRevisions) {
  return p.cursor === p.revisions.length - 1 && !!tipPlacement(p)?.ahead.length;
}
