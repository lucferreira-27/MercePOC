/**
 * Perguntar ou fazer: o Jev consegue separar a pergunta necessária da
 * pergunta a mais? Mede sem chamar o modelo, com as perguntas que o
 * assistente já fez nas rodadas do bench.
 *
 *   npm run bench:askact -- --extract   # refaz bench/askact-cases.mjs de bench/results
 *   npm run bench:askact                # testa as variantes (precisa de TYPESAFE_API_KEY)
 *   npm run bench:askact -- --show      # imprime cada pergunta errada
 *
 * Rótulo de cada pergunta vem do caso (askAct em bench/cases.mjs): pergunta
 * num caso 'agir' ou 'responder' é a mais; num caso 'perguntar' é legítima;
 * 'livre' só aparece no relatório. As variantes estão em lib/agent/ask-gate.ts.
 */
import { readFileSync, readdirSync, writeFileSync, existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

process.env.MERCE_DATA_DIR = mkdtempSync(join(tmpdir(), 'merce-askact-'));
const args = process.argv.slice(2);
const OUT = resolve('bench/askact-cases.mjs');

// O .env tem a chave do Jev; um script solto não lê sozinho.
if (existsSync('.env'))
  for (const line of readFileSync('.env', 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
  }

const { cases } = await import('./cases.mjs');
const byId = Object.fromEntries(cases.map((c) => [c.id, c]));

/** Projeto do caso depois da preparação: seleção e prateleiras, para as regras. */
async function factsOf(c) {
  const { applyRequest, create, get } = await import('../lib/store.ts');
  const { askState } = await import('../lib/agent/ask-gate.ts');
  const project = get(create().id);
  if (c.setup?.ops?.length) applyRequest(project, c.setup.ops, 'preparação');
  const design = project.revisions[project.cursor].params;
  const selected = (c.setup?.selected ?? []).length > 0;
  return { selected, shelves: design.shelves.length, estado: askState(design, selected) };
}

if (args.includes('--extract')) {
  const asks = new Map();
  const under = {};
  let total = 0;
  for (const file of readdirSync('bench/results').filter((f) => f.endsWith('.json')).sort()) {
    let s;
    try {
      s = JSON.parse(readFileSync(join('bench/results', file), 'utf8'));
    } catch {
      continue;
    }
    for (const r of s.results ?? []) {
      const c = byId[r.id];
      if (!c) continue;
      if (c.askAct === 'perguntar' && ['update', 'undo', 'redo'].includes(r.action)) under[r.id] = (under[r.id] ?? 0) + 1;
      if (r.action !== 'clarify') continue;
      const pergunta = String(r.decision?.message ?? '').trim();
      if (!pergunta) continue;
      total++;
      const key = `${r.id}|${pergunta}`;
      const seen = asks.get(key);
      if (seen) seen.seen++;
      else asks.set(key, { id: r.id, askAct: c.askAct, pedido: c.prompt, pergunta, seen: 1, laço: !!(s.agent || r.steps) });
    }
  }
  const facts = {};
  for (const id of new Set([...asks.values()].map((a) => a.id))) facts[id] = await factsOf(byId[id]);
  const rows = [...asks.values()]
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : b.seen - a.seen))
    .map((a) => ({ ...a, selected: facts[a.id].selected, shelves: facts[a.id].shelves }));
  const text = `/**
 * Perguntas que o assistente fez nas rodadas do bench (bench/results), sem
 * repetir o par pedido + pergunta. Gerado por \`npm run bench:askact -- --extract\`;
 * medido por \`npm run bench:askact\`. \`seen\`: quantas vezes apareceu;
 * \`laço\`: veio do assistente em laço (senão, do caminho antigo).
 */
export const askActCases = [
${rows.map((r) => `  ${JSON.stringify(r)},`).join('\n')}
];

/** Vezes em que o assistente fez sem perguntar num caso 'perguntar'. */
export const underAsks = ${JSON.stringify(under)};
`;
  writeFileSync(OUT, text);
  const by = rows.reduce((a, r) => ((a[r.askAct] = (a[r.askAct] ?? 0) + 1), a), {});
  console.log(`${total} perguntas, ${rows.length} sem repetir (${Object.entries(by).map(([k, v]) => `${k} ${v}`).join(', ')}); feitas sem perguntar: ${JSON.stringify(under)}`);
  console.log(`escrito em ${OUT}`);
  process.exit(0);
}

const { askJev, jevAvailable } = await import('../lib/agent/jev.ts');
const gate = await import('../lib/agent/ask-gate.ts');
if (!jevAvailable()) {
  console.error('Sem TYPESAFE_API_KEY: nada a medir.');
  process.exit(1);
}
const { askActCases, underAsks } = await import('./askact-cases.mjs');
const show = args.includes('--show');

/** Chamadas ao Jev com poucas em voo, e o tempo de cada uma. */
const lat = { A: [], 'A+': [], B: [], C: [], 'C+': [] };
let inFlight = 0;
const waiters = [];
async function jev(tag, state, questions) {
  while (inFlight >= 8) await new Promise((r) => waiters.push(r));
  inFlight++;
  const t = Date.now();
  try {
    return await askJev(state, questions);
  } finally {
    lat[tag].push(Date.now() - t);
    inFlight--;
    waiters.shift()?.();
  }
}

// Perguntas sobre o pedido, uma vez por caso (B e C).
const ids = [...new Set([...askActCases.map((a) => a.id), ...cases.map((c) => c.id)])];
const facts = Object.fromEntries(await Promise.all(ids.map(async (id) => [id, await factsOf(byId[id])])));
const perRequest = Object.fromEntries(
  await Promise.all(
    cases.map(async (c) => {
      const [req, need, needPlus] = await Promise.all([
        jev('B', { pedido: c.prompt }, gate.requestQuestions()),
        jev('C', { pedido: c.prompt }, gate.needQuestions()),
        jev('C+', { pedido: c.prompt, projeto: facts[c.id].estado, produto: gate.PRODUCT_RULES }, gate.needQuestions()),
      ]);
      return [c.id, { req, need, needPlus }];
    }),
  ),
);
const perAsk = await Promise.all(
  askActCases.map(async (a) => {
    const [pair, pairPlus, kind] = await Promise.all([
      jev('A', { pedido: a.pedido, pergunta: a.pergunta }, gate.pairQuestions()),
      jev('A+', { pedido: a.pedido, pergunta: a.pergunta, produto: gate.PRODUCT_RULES }, gate.pairQuestions()),
      jev('B', { pergunta: a.pergunta }, gate.kindQuestions()),
    ]);
    return { a, pair, pairPlus, kind };
  }),
);

const over = (a) => a.askAct === 'agir' || a.askAct === 'responder';
const legit = (a) => a.askAct === 'perguntar';
const pctOf = (n, d) => (d ? `${Math.round((n / d) * 100)}%` : '-');
const median = (v) => (v.length ? [...v].sort((x, y) => x - y)[v.length >> 1] : 0);

/** Placar de um jeito de barrar: pega a mais, barra legítima, pesos por vezes vistas. */
function score(name, blocks, tag) {
  let caught = 0, overN = 0, blocked = 0, legitN = 0, livreBlocked = 0, livreN = 0, failed = 0, wCaught = 0, wOver = 0;
  const wrong = [];
  for (const row of perAsk) {
    const b = blocks(row);
    if (b === null) {
      failed++;
      continue;
    }
    const { a } = row;
    if (over(a)) {
      overN++;
      wOver += a.seen;
      if (b) {
        caught++;
        wCaught += a.seen;
      } else wrong.push(`deixou   ${a.id} (${a.askAct}): ${a.pergunta.slice(0, 110)}`);
    } else if (legit(a)) {
      legitN++;
      if (b) {
        blocked++;
        wrong.push(`BARROU   ${a.id} (${a.askAct}): ${a.pergunta.slice(0, 110)}`);
      }
    } else {
      livreN++;
      if (b) livreBlocked++;
    }
  }
  return { name, caught, overN, wCaught, wOver, blocked, legitN, livreBlocked, livreN, failed, wrong, ms: median(lat[tag]) };
}

const rows = [];
for (const min of [0.3, 0.5, 0.7]) {
  rows.push(score(`A  par ≥${min}`, ({ pair }) => (pair ? gate.pairBlocks(pair, min) : null), 'A'));
  rows.push(score(`A+ par+regras ≥${min}`, ({ pairPlus }) => (pairPlus ? gate.pairBlocks(pairPlus, min) : null), 'A+'));
}
for (const min of [0.3, 0.5, 0.7])
  rows.push(
    score(
      `B  espécie ≥${min}`,
      ({ a, kind }) => {
        const req = perRequest[a.id]?.req;
        if (!kind || !req) return null;
        return !gate.kindVerdict(kind, req, { pedido: a.pedido, ...facts[a.id] }, min).legit;
      },
      'B',
    ),
  );

console.log(`\n${askActCases.length} perguntas sem repetir: ${askActCases.filter(over).length} a mais (agir/responder), ${askActCases.filter(legit).length} legítimas (perguntar), ${askActCases.filter((a) => a.askAct === 'livre').length} livres\n`);
console.log('variante                   pega a mais         (por vezes vistas)   barra legítima   livre barrada   sem resposta   mediana Jev');
for (const r of rows)
  console.log(
    `${r.name.padEnd(26)} ${`${r.caught}/${r.overN} ${pctOf(r.caught, r.overN)}`.padEnd(19)} ${`${r.wCaught}/${r.wOver} ${pctOf(r.wCaught, r.wOver)}`.padEnd(20)} ${`${r.blocked}/${r.legitN}`.padEnd(16)} ${`${r.livreBlocked}/${r.livreN}`.padEnd(15)} ${String(r.failed).padEnd(14)} ${r.ms} ms${r.caught / Math.max(1, r.overN) >= 0.7 && r.blocked <= 1 ? '   ← passa' : ''}`,
  );

// Espécies que o Jev deu, por rótulo: mostra onde B acerta e onde erra.
const kinds = {};
for (const { a, kind } of perAsk) {
  const k = kind?.especie?.choice ?? '?';
  const g = (kinds[a.askAct] ??= {});
  g[k] = (g[k] ?? 0) + 1;
}
console.log('\nespécie da pergunta (B), por rótulo do caso:');
for (const [label, g] of Object.entries(kinds)) console.log(`  ${label.padEnd(10)} ${Object.entries(g).sort((x, y) => y[1] - x[1]).map(([k, v]) => `${k} ${v}`).join(', ')}`);

// C: o pedido sozinho, no começo do turno. Pega o "fez sem perguntar"?
console.log('\nC: o pedido precisa de resposta antes? (todos os casos)');
for (const [tag, pick] of [['C', (v) => v.need], ['C+', (v) => v.needPlus]])
  for (const min of [0.3, 0.5, 0.7]) {
    let hit = 0, n = 0, falseAsk = 0, m = 0;
    const flagged = [];
    for (const c of cases) {
      const ans = pick(perRequest[c.id]);
      if (!ans || c.askAct === 'livre') continue;
      const need = gate.needsAsk(ans, min);
      if (c.askAct === 'perguntar') {
        n++;
        if (need) hit++;
      } else {
        m++;
        if (need) {
          falseAsk++;
          flagged.push(c.id);
        }
      }
    }
    console.log(`  ${`${tag} ≥${min}`.padEnd(9)} perguntar marcados ${hit}/${n} · agir/responder marcados ${falseAsk}/${m}${flagged.length ? ` (${flagged.slice(0, 10).join(' ')}${flagged.length > 10 ? '…' : ''})` : ''} · mediana ${median(lat[tag])} ms`);
  }
console.log(`  fez sem perguntar nas rodadas: ${Object.entries(underAsks).map(([k, v]) => `${k} ×${v}`).join(', ') || 'nenhum'}`);
console.log('\nC por caso perguntar (noul de C, C+):');
for (const c of cases.filter((v) => v.askAct === 'perguntar'))
  console.log(`  ${c.id} ${(perRequest[c.id].need?.precisa?.noul ?? NaN).toFixed(2)} ${(perRequest[c.id].needPlus?.precisa?.noul ?? NaN).toFixed(2)}  ${c.prompt}`);

if (show)
  for (const r of rows.filter((v) => /≥0.5/.test(v.name))) {
    console.log(`\n--- ${r.name}`);
    for (const w of r.wrong) console.log('  ' + w);
  }
