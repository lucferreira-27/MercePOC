/**
 * Retrato do motor na v3: peças, desenho, orçamento e plano de corte de
 * projetos reais (cenas do bench), de cada ativo nas medidas de ponta e das
 * demos. O teste de migração compara a v4 com este arquivo: projeto antigo
 * abre igual. Refazer (só quando a mudança no motor for de propósito):
 * `npx tsx tests/fixtures/golden-v3.ts --write`.
 *
 * O desenho deixa de fora as ferragens que a v4 passou a desenhar (puxador,
 * contorno, LED) e numera os pés por módulo: o resto tem de bater.
 */
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import * as engine from '../../lib/composition';
import { assets, buildAsset } from '../../lib/assets';
import { DEMOS, buildDemo } from '../../lib/demos';
import { DEFAULT_PRICES, quote } from '../../lib/quote';
import { canonical, normalize } from '../../lib/studio';

type Part = engine.ModularPart;
const r = (v: number) => Math.round(v * 100) / 100;
/** O desenho mora em lib/fittings.ts desde a v4; antes, em lib/composition.ts. */
const draw: (d: engine.Composition) => Part[] =
  (engine as unknown as { drawingParts?: (d: engine.Composition) => Part[] }).drawingParts ??
  (await import('../../lib/fittings')).drawingParts;

/** O que o motor devolve de um projeto, em forma comparável. */
export function snapshotOf(input: unknown) {
  const d = canonical(normalize(input as engine.Composition));
  const g = engine.generateComposition(d);
  const q = quote(g.parts, d.modules.length, DEFAULT_PRICES);
  const feet = new Map<string, number>();
  return {
    parts: g.parts.map((p) => [p.id, p.kind, p.material, p.size.map(r), p.position.map(r), r(p.rotation), r(p.c), r(p.l), p.thickness, p.owners.join('+'), p.cellId ?? '', Object.values(p.edges).map((e) => e ?? '-').join('|')].join(' ')),
    drawing: draw(d)
      .filter((p) => !/:(handle|frame-|led|stand|sled-|levelers)/.test(p.id))
      .map((p) => {
        const foot = /^(.*):foot-\d+$/.exec(p.id);
        const id = foot ? `${foot[1]}:foot-${feet.set(foot[1], (feet.get(foot[1]) ?? -1) + 1).get(foot[1])}` : p.id;
        return [id, p.size.map(r), p.position.map(r)].join(' ');
      }),
    bounds: [g.bounds.min.map(r), g.bounds.max.map(r)],
    quote: { total: q.total, lines: q.lines.map((l) => `${l.section}|${l.label}|${l.qty}|${l.unitPrice}|${l.total}`) },
    sheets: q.plan.sheets.map((s) => `${s.key}:${s.placements.length}`),
  };
}

/** Os projetos do retrato, com o nome de cada um. */
export function goldenInputs(): { name: string; design: unknown }[] {
  const out: { name: string; design: unknown }[] = [];
  const dir = join(import.meta.dirname, '..', '..', 'bench', 'scenes');
  for (const f of readdirSync(dir).filter((v) => v.endsWith('.json')).sort())
    out.push({ name: `cena ${f}`, design: JSON.parse(readFileSync(join(dir, f), 'utf8')).design });
  for (const a of assets)
    for (const [label, size] of [
      ['padrão', a.size.default],
      ['mínimo', a.size.min],
      ['máximo', a.size.max],
    ] as const)
      out.push({ name: `ativo ${a.id} ${label}`, design: buildAsset(a, size) });
  const now = new Date('2026-09-30T12:00:00Z');
  DEMOS.forEach((recipe, i) => {
    const { project } = buildDemo(recipe, i, now);
    for (const rev of project.revisions) out.push({ name: `demo ${recipe.key} v${rev.number}`, design: rev.params });
  });
  return out;
}

/**
 * Impressão do retrato: o arquivo guarda só isto, e o teste recalcula o resto.
 * Ids sorteados (`front-3f9a…`, de uid) viram a ordem em que aparecem, senão
 * dois retratos do mesmo móvel nunca batem.
 */
export function digest(snapshot: unknown) {
  const seen = new Map<string, string>();
  const text = JSON.stringify(snapshot).replace(/\b(front|cell|panel|module|connection)-[0-9a-f]{8}-[0-9a-f]{3}/g, (id, kind: string) => {
    if (!seen.has(id)) seen.set(id, `${kind}-#${seen.size + 1}`);
    return seen.get(id)!;
  });
  return createHash('sha1').update(text).digest('hex');
}

if (process.argv.includes('--write')) {
  const golden = Object.fromEntries(goldenInputs().map(({ name, design }) => [name, digest(snapshotOf(design))]));
  writeFileSync(join(import.meta.dirname, 'golden-v3.json'), `${JSON.stringify(golden, null, 1)}\n`);
  console.log(`${Object.keys(golden).length} projetos gravados`);
}
