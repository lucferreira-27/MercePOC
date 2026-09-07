import { materials, type Params } from './furniture';
export type Progress = {
  stage: 'connecting' | 'interpreting' | 'retrying' | 'validating' | 'saving';
  label: string;
  detail: string;
  attempt?: number;
};
export type ChatReport = {
  durationMs: number;
  outcome: 'updated' | 'clarification' | 'unchanged' | 'rejected';
  changes: string[];
  approach?: string;
};
export type TextPreview = { approach: string; answer: string; attempt: number };
export function describeChanges(before: Params, after: Params) {
  const labels: Record<keyof Params, string> = {
    width: 'Largura',
    height: 'Altura',
    depth: 'Profundidade',
    shelfCount: 'Prateleiras',
    materialId: 'Material',
    bottomOpening: 'Vão inferior',
  };
  const value = (key: keyof Params, p: Params) =>
    key === 'materialId'
      ? materials.find((m) => m.id === p.materialId)!.name
      : key === 'shelfCount'
        ? String(p[key])
        : p[key] === null
          ? 'distribuição igual'
          : `${p[key]} mm`;
  return (Object.keys(labels) as (keyof Params)[])
    .filter((key) => before[key] !== after[key])
    .map(
      (key) => `${labels[key]}: ${value(key, before)} → ${value(key, after)}`,
    );
}
