import type { Part } from './furniture';

/**
 * Agrupa peças idênticas para a folha impressa: quatro prateleiras iguais são
 * uma linha com quantidade 4, não quatro linhas com quantidade 1.
 */
export function groupParts(parts: readonly Part[]) {
  const rows = new Map<
    string,
    { key: string; name: string; count: number; c: number; l: number; thickness: number; material: string; area: number }
  >();
  for (const part of parts) {
    // O nome do módulo sai do agrupamento: "Coluna 1 / Base" e "Coluna 2 /
    // Base" de mesma medida são a mesma peça na oficina.
    const name = part.name.includes(' / ') ? part.name.split(' / ').slice(1).join(' / ') : part.name;
    const key = [name, part.c, part.l, part.thickness, part.material].join('|');
    const row = rows.get(key);
    if (row) {
      row.count += 1;
      row.area += (part.c * part.l) / 1_000_000;
    } else
      rows.set(key, {
        key,
        name,
        count: 1,
        c: part.c,
        l: part.l,
        thickness: part.thickness,
        material: part.material,
        area: (part.c * part.l) / 1_000_000,
      });
  }
  return [...rows.values()].sort((a, b) => a.material.localeCompare(b.material) || b.c * b.l - a.c * a.l);
}
