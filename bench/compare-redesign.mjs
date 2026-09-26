/**
 * Comparação do redesenho: base (código antes do redesenho, Luna alta) contra
 * o candidato, caso a caso, no grupo `composicao`.
 *
 *   npx tsx bench/compare-redesign.mjs --base <a.json,b.json> --judge <rejulgada.json> --cand <final.json> [--md saida.md]
 *
 * `--base` são as rodadas ao vivo da base (tempo, chamadas, custo, recusas);
 * `--judge` é a mesma base repetida offline com o oráculo final (acerto),
 * porque o oráculo mudou depois das primeiras rodadas (folga da TV, cena sem
 * ambiente). Quando um caso aparece em mais de um arquivo, vale o último.
 * Linhas de infraestrutura (provedor fora) ficam fora das taxas e são contadas
 * à parte.
 */
import { readFileSync, writeFileSync } from 'node:fs';

const args = process.argv.slice(2);
const value = (name) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : '';
};
const load = (list) =>
  list
    .split(',')
    .filter(Boolean)
    .map((f) => JSON.parse(readFileSync(f, 'utf8')));
/** Linhas por caso; arquivo mais à direita vence para o mesmo caso. */
function rowsByCase(files) {
  const out = new Map();
  for (const f of files) {
    const seen = new Map();
    for (const r of f.results) {
      if (!seen.has(r.id)) seen.set(r.id, []);
      seen.get(r.id).push(r);
    }
    for (const [id, rows] of seen) out.set(id, rows);
  }
  return out;
}
const base = rowsByCase(load(value('base')));
const judge = rowsByCase(load(value('judge')));
const cand = rowsByCase(load(value('cand')));
const held = new Set((value('held') || 'tv-03,esc-01').split(','));

const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? (s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : 0;
};
const p90 = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.min(s.length - 1, Math.round(0.9 * (s.length - 1)))] : 0;
};
const sum = (xs) => xs.reduce((a, b) => a + b, 0);
const secs = (ms) => `${(ms / 1000).toFixed(0)} s`;

function side(live, verdict) {
  const valid = live.filter((r) => !r.infra);
  const pass = (verdict ?? live).filter((r) => !r.infra && r.ok).length;
  const n = (verdict ?? live).filter((r) => !r.infra).length;
  return {
    pass,
    n,
    infra: live.length - valid.length,
    rejected: sum(valid.map((r) => r.rejected ?? 0)),
    calls: sum(valid.map((r) => r.calls)),
    latencies: valid.map((r) => r.latencyMs),
    cost: sum(live.map((r) => r.costUsd ?? 0)),
    runs: valid.length,
  };
}

const ids = [...new Set([...cand.keys()])].filter((id) => base.has(id));
const rows = ids.map((id) => {
  const b = side(base.get(id), judge.get(id) ?? base.get(id));
  const c = side(cand.get(id));
  return { id, held: held.has(id), b, c };
});
const total = (pick) => {
  const all = rows.filter(pick);
  const agg = (k) => ({
    pass: sum(all.map((r) => r[k].pass)),
    n: sum(all.map((r) => r[k].n)),
    infra: sum(all.map((r) => r[k].infra)),
    rejected: sum(all.map((r) => r[k].rejected)),
    calls: sum(all.map((r) => r[k].calls)),
    runs: sum(all.map((r) => r[k].runs)),
    latencies: all.flatMap((r) => r[k].latencies),
    cost: sum(all.map((r) => r[k].cost)),
  });
  return { b: agg('b'), c: agg('c') };
};
const pct = (a, n) => (n ? `${Math.round((a / n) * 100)}%` : '-');
const line = (label, t) =>
  `| ${label} | ${t.b.pass}/${t.b.n} (${pct(t.b.pass, t.b.n)}) | ${t.c.pass}/${t.c.n} (${pct(t.c.pass, t.c.n)}) | ${t.b.rejected} → ${t.c.rejected} | ${(t.b.calls / Math.max(1, t.b.runs)).toFixed(1)} → ${(t.c.calls / Math.max(1, t.c.runs)).toFixed(1)} | ${secs(median(t.b.latencies))} → ${secs(median(t.c.latencies))} | ${secs(p90(t.b.latencies))} → ${secs(p90(t.c.latencies))} | US$ ${(t.b.cost / Math.max(1, t.b.runs)).toFixed(4)} → ${(t.c.cost / Math.max(1, t.c.runs)).toFixed(4)} |`;

const md = [
  '| Conjunto | Base | Candidato | Recusas | Chamadas/caso | Mediana | p90 | Custo/caso |',
  '| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |',
  line('Desenvolvimento', total((r) => !r.held)),
  line('Guardados (tv-03, esc-01)', total((r) => r.held)),
  line('Todos', total(() => true)),
  '',
  '| Caso | Base | Candidato | Recusas | Chamadas | Mediana |',
  '| --- | ---: | ---: | ---: | ---: | ---: |',
  ...rows.map(
    (r) =>
      `| ${r.id}${r.held ? ' (guardado)' : ''} | ${r.b.pass}/${r.b.n} | ${r.c.pass}/${r.c.n}${r.c.infra ? ` (+${r.c.infra} infra)` : ''} | ${r.b.rejected} → ${r.c.rejected} | ${(r.b.calls / Math.max(1, r.b.runs)).toFixed(1)} → ${(r.c.calls / Math.max(1, r.c.runs)).toFixed(1)} | ${secs(median(r.b.latencies))} → ${secs(median(r.c.latencies))} |`,
  ),
].join('\n');
console.log(md);
if (value('md')) writeFileSync(value('md'), `${md}\n`);

// Falhas do candidato, para o relatório não esconder nenhuma.
const fails = [...cand.values()].flat().filter((r) => !r.ok);
if (fails.length) {
  console.log('\nFalhas do candidato:');
  for (const f of fails) console.log(`- ${f.id}#${f.run}${f.infra ? ' (infra)' : ''}: ${f.errors.join(' | ')}`);
}
