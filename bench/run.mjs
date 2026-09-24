/**
 * Runner do benchmark do Merce.
 *
 * Mede o caminho real do produto (prompt + modelo + validação + reparo) contra
 * um corpus de casos, e permite comparar duas execuções para saber se uma
 * mudança no prompt, no esquema de operações ou no modelo melhorou ou piorou.
 *
 * Uso:
 *   npm run bench                          # todos os casos, uma vez cada
 *   npm run bench -- --group divisao       # um grupo
 *   npm run bench -- --id amb-01 --repeat 3
 *   npm run bench -- --record              # grava as decisões em bench/fixtures
 *   npm run bench -- --offline             # roda sem rede, contra as fixtures
 *   npm run bench -- --out bench/results/depois.json
 *   npm run bench -- --compare bench/results/antes.json
 *
 * Casos com `image` (foto de referência) usam o arquivo indicado no caso. A
 * foto não é versionada: sem o arquivo o caso é pulado, com o motivo impresso,
 * em vez de virar falha por falta de insumo.
 */
import { mkdirSync, mkdtempSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';

// O banco do benchmark é temporário: a base real nunca é tocada.
process.env.MERCE_DATA_DIR = mkdtempSync(join(tmpdir(), 'merce-bench-'));

const { applyRequest, create, get, revise, save } = await import('../lib/store.ts');
const { saveImage } = await import('../lib/images.ts');
const { planDataUrl } = await import('../lib/plan-render.ts');
const { interpretStream } = await import('../lib/gateway.ts');
const { addUsage, emptyUsage, priceOf, MODEL_KEYS } = await import('../lib/models.ts');
const { executeRequest, generateDesign, entityIds } = await import('../lib/studio.ts');
const { cases, groups } = await import('./cases.mjs');

const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const value = (name, fallback = '') => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};

if (flag('list')) {
  for (const [group, about] of Object.entries(groups)) {
    console.log(`\n${group} · ${about}`);
    for (const c of cases.filter((v) => v.group === group)) console.log(`  ${c.id}  ${c.prompt}`);
  }
  process.exit(0);
}

const onlyGroup = value('group');
const onlyId = value('id');
const repeat = Math.max(1, Number(value('repeat', '1')));
const offline = flag('offline');
const record = flag('record');
const fast = flag('fast');
// --model deepseek|luna|mimo|qwen-fast escolhe o modelo; --fast é o atalho antigo.
const model = value('model', fast ? 'qwen-fast' : 'deepseek');
if (!MODEL_KEYS.includes(model)) {
  console.error(`Modelo desconhecido: ${model}. Use ${MODEL_KEYS.join(', ')}.`);
  process.exit(1);
}
const budgetSeconds = Number(value('budget', '0'));
const maxCalls = Number(value('max-calls', '0'));
const pauseMs = Number(value('pause', '400'));
const onlyMissing = flag('only-missing');
const networkAttempts = Math.max(1, Number(value('network-attempts', '4')));
const outFile = value('out');
const compareFile = value('compare');
const fixtureDir = resolve('bench/fixtures');

// O app lê o .env pelo servidor; um script solto não. Carrega aqui para o
// benchmark usar o mesmo provedor, sem imprimir nenhum valor.
function loadEnv(file) {
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
    if (!match) continue;
    const [, key, raw] = match;
    if (process.env[key]) continue;
    process.env[key] = raw.trim().replace(/^["']|["']$/g, '');
  }
}
loadEnv(resolve(value('env', '.env')));


const selected = cases.filter(
  (c) => (!onlyGroup || c.group === onlyGroup) && (!onlyId || c.id.includes(onlyId)),
);
if (!selected.length) {
  console.error('Nenhum caso selecionado.');
  process.exit(1);
}

const startedAll = Date.now();
let providerCalls = 0;
let providerMs = 0;
const realFetch = globalThis.fetch;
globalThis.fetch = async (...callArgs) => {
  providerCalls++;
  const t0 = Date.now();
  try {
    return await realFetch(...callArgs);
  } finally {
    providerMs += Date.now() - t0;
  }
};

/** Mesmo laço de reparo da rota: erro de validação volta para o modelo. */
async function interpretWithRepair(before, revision, messages, selection, context, telemetry, currentView) {
  const callOnce = async (note) => {
    const t0 = Date.now();
    const callsBefore = providerCalls;
    let decision;
    for (let attempt = 1; ; attempt++) {
      try {
        decision = await interpretStream(
      before,
      revision.id,
      revision.number,
      messages,
      selection,
      note ? { ...context, historyNote: note } : context,
      (event) => {
        if (event.stage === 'retrying') telemetry.retries++;
      },
      0,
      undefined,
          () => {},
          model,
          undefined,
          // O app manda o desenho do projeto atual em turno com foto: o
          // benchmark manda o mesmo, senão mede um caminho que ninguém usa.
          currentView,
          // Custo real: tokens do provedor com a tabela de preço do modelo.
          (usage) => (telemetry.usage = addUsage(telemetry.usage, usage, priceOf(model, process.env))),
        );
        break;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        // Falha de rede ou limite do provedor não é resultado do benchmark:
        // tenta de novo com espera crescente e conta separado.
        const transient =
          /fetch failed|ECONNRESET|ETIMEDOUT|socket|terminated|429|502|503|504|load failed/i.test(message);
        if (!transient || attempt >= networkAttempts) throw error;
        const ladder = /429/i.test(message) ? [5000, 20000, 45000] : [1500, 5000, 12000];
        const wait = ladder[Math.min(attempt - 1, ladder.length - 1)];
        telemetry.networkRetries++;
        console.log(`   (provedor indisponível: ${message.slice(0, 70)}; nova tentativa em ${Math.round(wait / 1000)}s)`);
        await new Promise((done) => setTimeout(done, wait));
      }
    }
    telemetry.latencyMs += Date.now() - t0;
    telemetry.calls += providerCalls - callsBefore;
    return decision;
  };
  let decision = await callOnce(undefined);
  let ops = decision.action === 'update' ? decision.ops ?? [] : [];
  let preview = ops.length ? executeRequest(before, ops) : { ok: true, design: before, noop: true };
  for (let attempt = 1; !preview.ok && attempt <= 2; attempt++) {
    decision = await callOnce(
      `A proposta anterior não passou na validação: ${preview.error} A composição não mudou. Reenvie o pedido completo, corrigido, com todas as operações necessárias.`,
    );
    if (decision.action !== 'update') break;
    ops = decision.ops ?? [];
    preview = ops.length ? executeRequest(before, ops) : { ok: true, design: before, noop: true };
  }
  return { decision, ops, preview };
}

function evaluate(benchCase, info, helpers) {
  const errors = [];
  const expect = benchCase.expect ?? {};
  const allowed = expect.action
    ? Array.isArray(expect.action)
      ? expect.action
      : [expect.action]
    : null;
  if (allowed && !allowed.includes(info.action)) {
    errors.push(`ação ${info.action} fora do esperado (${allowed.join(', ')})`);
  }
  if (expect.applied !== undefined && expect.applied !== info.applied) {
    errors.push(
      expect.applied
        ? 'não criou revisão, mas devia mudar o projeto'
        : 'criou revisão, mas o caso não devia mudar nada',
    );
  }
  if (expect.design && info.action === 'update') {
    const verdict = expect.design(helpers.design, helpers, info);
    if (verdict !== true) errors.push(String(verdict));
  }
  if (expect.content) {
    for (const re of expect.content.mustMatch ?? [])
      if (!re.test(info.content)) errors.push(`resposta não citou ${re}`);
    for (const re of expect.content.mustNotMatch ?? [])
      if (re.test(info.content)) errors.push(`resposta trouxe o que não devia (${re})`);
  }
  if (expect.clarify) {
    if (info.action !== 'clarify') errors.push('não pediu esclarecimento');
    if (expect.clarify.minOptions && info.options.length < expect.clarify.minOptions)
      errors.push(`cartão com ${info.options.length} opção(ões)`);
    if (expect.clarify.aliveOptions && info.deadOptions)
      errors.push(`${info.deadOptions} opção(ões) apontam para peças que não existem`);
  }
  // Sugestões de próximo passo: o chip é atalho e precisa ser deste projeto.
  // Pergunta (clarify) não chega aqui com sugestão: o servidor monta o cartão e
  // nunca copia a lista da IA, então exigir "vazio" seria uma regra que não
  // pode falhar.
  const regras = expect.suggestions;
  if (regras) {
    const lista = info.suggestions;
    if (lista.length < (regras.min ?? 2))
      errors.push(`sugeriu ${lista.length} próximo(s) passo(s)`);
    if (regras.max && lista.length > regras.max)
      errors.push(`${lista.length} sugestões (máximo ${regras.max})`);
    if (regras.maxChars && lista.some((v) => v.length > regras.maxChars))
      errors.push(`sugestão com mais de ${regras.maxChars} caracteres`);
    if (regras.mustMatch && !lista.some((v) => regras.mustMatch.some((re) => re.test(v))))
      errors.push(`sugestões fora do contexto (${lista.join(' | ')})`);
    if (regras.mustNotMatch && lista.some((v) => regras.mustNotMatch.some((re) => re.test(v))))
      errors.push(`sugestão que o produto não faz (${lista.join(' | ')})`);
  }
  return errors;
}

const results = [];
const skipped = [];
let stopped = false;
for (const benchCase of selected) {
  const fixturePath = join(fixtureDir, `${benchCase.id}.json`);
  if (onlyMissing && existsSync(fixturePath)) {
    console.log(`pulado ${benchCase.id} (fixture já gravada)`);
    continue;
  }
  const imagePath = benchCase.image ? resolve(benchCase.image) : '';
  if (imagePath && !existsSync(imagePath)) {
    console.log(`pulado ${benchCase.id} (sem a foto ${benchCase.image}; coloque o arquivo para rodar)`);
    skipped.push({ id: benchCase.id, reason: `foto ausente: ${benchCase.image}` });
    continue;
  }
  for (let run = 1; run <= repeat && !stopped; run++) {
    if (pauseMs) await new Promise((done) => setTimeout(done, pauseMs));
    const telemetry = { latencyMs: 0, calls: 0, retries: 0, networkRetries: 0, usage: emptyUsage(model) };
    const row = {
      id: benchCase.id,
      group: benchCase.group,
      run,
      prompt: benchCase.prompt,
      ok: false,
      errors: [],
      action: '',
      applied: false,
      calls: 0,
      retries: 0,
      networkRetries: 0,
      latencyMs: 0,
      warnings: [],
      decision: null,
    };
    try {
      const project = get(create().id);
      if (benchCase.setup?.ops?.length) {
        const applied = applyRequest(project, benchCase.setup.ops, `preparação ${benchCase.id}`);
        if (!applied.ok) throw new Error(`preparação falhou: ${applied.error}`);
        save(project, project.version);
      }
      const fresh = get(project.id);
      const revision = fresh.revisions[fresh.cursor];
      const before = revision.params;
      const selection = benchCase.setup?.selected ?? [];
      // A foto entra como o app manda: salva no diretório de dados e
      // referenciada na mensagem, para o prompt receber o mesmo bloco de
      // estimativa calibrada que um pedido real recebe.
      const image = imagePath
        ? await saveImage(readFileSync(imagePath), basename(imagePath))
        : null;
      const messages = [
        {
          id: 'bench-user',
          role: 'user',
          content: benchCase.prompt,
          ...(image ? { image } : {}),
        },
      ];
      const context = {
        requestId: `bench-${benchCase.id}-${run}`,
        baseRevisionId: revision.id,
        selectedPartIds: selection,
        referencedPartIds: selection,
      };

      const fixtureFile = fixturePath;
      let decision;
      if (offline) {
        if (!existsSync(fixtureFile)) throw new Error('sem fixture gravada (rode com --record)');
        const fixture = JSON.parse(readFileSync(fixtureFile, 'utf8'));
        decision = fixture.decision;
        telemetry.calls = 1;
      } else {
        const interpreted = await interpretWithRepair(
          before,
          revision,
          messages,
          selection,
          context,
          telemetry,
          image ? await planDataUrl(generateDesign(before).parts) : undefined,
        );
        decision = interpreted.decision;
        row.preview = interpreted.preview;
        if (record) {
          mkdirSync(fixtureDir, { recursive: true });
          writeFileSync(
            fixtureFile,
            JSON.stringify(
              {
                id: benchCase.id,
                at: new Date().toISOString(),
                decision,
                latencyMs: Math.round(telemetry.latencyMs),
                calls: telemetry.calls,
                retries: telemetry.retries,
              },
              null,
              1,
            ),
          );
        }
      }

      const action = decision.action ?? '?';
      const content = String(decision.message ?? '');
      let applied = false;
      let designAfter = before;
      let options = [];
      let deadOptions = 0;
      if (action === 'update') {
        const ops = decision.ops ?? [];
        const preview = row.preview ?? (ops.length ? executeRequest(before, ops) : { ok: true, design: before, noop: true });
        if (ops.length && preview.ok) {
          applied = JSON.stringify(preview.design) !== JSON.stringify(before);
          if (applied) {
            revise(project, preview.design, benchCase.prompt.slice(0, 60));
            save(project, project.version);
            designAfter = preview.design;
          }
        } else if (ops.length && !preview.ok) {
          row.errors.push(`validação recusou: ${preview.error}`);
        }
      } else if (action === 'undo' || action === 'redo') {
        const delta = action === 'undo' ? -1 : 1;
        const next = project.cursor + delta;
        if (next >= 0 && next < project.revisions.length) {
          project.cursor = next;
          save(project, project.version);
          applied = true;
        }
        designAfter = get(project.id).revisions[project.cursor].params;
      } else if (action === 'clarify') {
        options = decision.clarification?.options ?? [];
        const alive = new Set(entityIds(before));
        deadOptions = options.filter((o) => !(o.partIds ?? []).some((pid) => alive.has(pid))).length;
      }

      const generated = generateDesign(designAfter);
      row.warnings = generated.warnings ?? [];
      const helpers = {
        design: designAfter,
        before,
        parts: generated.parts,
        cells: generated.cells,
        content,
      };
      const info = {
        action,
        content,
        applied,
        options,
        deadOptions,
        suggestions: decision.suggestions ?? [],
      };
      row.action = action;
      row.applied = applied;
      row.decision = {
        action,
        message: content,
        ops: decision.ops ?? [],
        refs: decision.refs ?? [],
        suggestions: decision.suggestions ?? [],
      };
      row.errors.push(...evaluate(benchCase, info, helpers));
      row.ok = row.errors.length === 0;
    } catch (e) {
      row.errors.push(`exceção: ${e instanceof Error ? e.message : String(e)}`);
    }
    row.calls = telemetry.calls;
    row.retries = telemetry.retries;
    row.networkRetries = telemetry.networkRetries;
    row.latencyMs = Math.round(telemetry.latencyMs);
    row.costUsd = telemetry.usage.costUsd;
    row.tokens = { input: telemetry.usage.inputTokens, cached: telemetry.usage.cachedTokens, output: telemetry.usage.outputTokens };
    results.push(row);
    const mark = row.ok ? 'ok  ' : 'FALHA';
    const sugestoes = row.decision?.suggestions?.length
      ? ` · ${row.decision.suggestions.length} sugestão(ões)`
      : '';
    console.log(
      `${mark} ${row.id} · ${row.action.padEnd(7)} · ${String(row.latencyMs).padStart(6)} ms · ${row.calls} chamada(s)${sugestoes}${row.retries ? ` · ${row.retries} correção(ões)` : ''}${row.ok ? '' : ` · ${row.errors.join(' | ')}`}`,
    );
    if (budgetSeconds && (Date.now() - startedAll) / 1000 > budgetSeconds) {
      console.log(`\n(orçamento de ${budgetSeconds}s atingido: parando)`);
      stopped = true;
    }
    if (maxCalls && providerCalls > maxCalls) {
      console.log(`\n(teto de ${maxCalls} chamadas ao provedor atingido: parando)`);
      stopped = true;
    }
  }
}

globalThis.fetch = realFetch;

function stats(values) {
  if (!values.length) return { n: 0 };
  const sorted = [...values].sort((a, b) => a - b);
  const at = (p) => sorted[Math.min(sorted.length - 1, Math.round(p * (sorted.length - 1)))];
  return {
    n: sorted.length,
    mean: Math.round(values.reduce((a, b) => a + b, 0) / values.length),
    median: at(0.5),
    p90: at(0.9),
    max: sorted[sorted.length - 1],
    min: sorted[0],
  };
}

const byGroup = {};
for (const row of results) {
  const g = (byGroup[row.group] ??= { total: 0, ok: 0, latencies: [], calls: [], retries: 0 });
  g.total++;
  if (row.ok) g.ok++;
  g.latencies.push(row.latencyMs);
  g.calls.push(row.calls);
  g.retries += row.retries;
}
const summary = {
  at: new Date().toISOString(),
  offline,
  fast,
  model,
  cases: results.length,
  skipped,
  passed: results.filter((r) => r.ok).length,
  passRate: results.length ? results.filter((r) => r.ok).length / results.length : 0,
  latencyMs: stats(results.map((r) => r.latencyMs)),
  providerCalls: stats(results.map((r) => r.calls)),
  retries: results.reduce((a, r) => a + r.retries, 0),
  networkRetries: results.reduce((a, r) => a + r.networkRetries, 0),
  providerMsTotal: providerMs,
  costUsd: results.reduce((a, r) => a + (r.costUsd ?? 0), 0),
  groups: Object.fromEntries(
    Object.entries(byGroup).map(([name, g]) => [
      name,
      { total: g.total, ok: g.ok, passRate: g.ok / g.total, latency: stats(g.latencies), retries: g.retries },
    ]),
  ),
  failures: results
    .filter((r) => !r.ok)
    .map((r) => ({ id: r.id, action: r.action, errors: r.errors, ops: r.decision?.ops, message: r.decision?.message })),
  results,
};

console.log(`\n=== resumo (${model}) ===`);
console.log(
  `${summary.passed}/${summary.cases} casos (${(summary.passRate * 100).toFixed(0)}%) · latência média ${summary.latencyMs.mean} ms, mediana ${summary.latencyMs.median} ms, p90 ${summary.latencyMs.p90} ms, máx ${summary.latencyMs.max} ms · ${summary.providerCalls.mean} chamada(s) por caso · ${summary.retries} correção(ões) · custo US$ ${summary.costUsd.toFixed(4)} (US$ ${(summary.costUsd / Math.max(1, summary.cases)).toFixed(5)} por caso)`,
);
for (const [name, g] of Object.entries(summary.groups))
  console.log(`  ${name.padEnd(14)} ${g.ok}/${g.total}  latência mediana ${g.latency.median} ms${g.retries ? `  correções ${g.retries}` : ''}`);
if (skipped.length)
  console.log(`  pulados: ${skipped.map((s) => `${s.id} (${s.reason})`).join(', ')}`);
if (summary.failures.length) {
  console.log('\n=== falhas (o que aprender com elas) ===');
  for (const f of summary.failures) console.log(`- ${f.id}: ${f.errors.join(' | ')}`);
}

if (outFile) {
  mkdirSync(dirname(outFile), { recursive: true });
  writeFileSync(outFile, JSON.stringify(summary, null, 1));
  console.log(`\nresultado escrito em ${outFile}`);
}

if (compareFile) {
  if (!existsSync(compareFile)) {
    console.error(`\nbase de comparação não encontrada: ${compareFile}`);
  } else {
    const base = JSON.parse(readFileSync(compareFile, 'utf8'));
    const before = new Map(base.results.map((r) => [`${r.id}#${r.run}`, r]));
    const improved = [];
    const regressed = [];
    let latencyDelta = 0;
    let counted = 0;
    for (const row of results) {
      const old = before.get(`${row.id}#${row.run}`);
      if (!old) continue;
      latencyDelta += row.latencyMs - old.latencyMs;
      counted++;
      if (!old.ok && row.ok) improved.push(row.id);
      if (old.ok && !row.ok) regressed.push(`${row.id} (${row.errors.join(' | ')})`);
    }
    console.log('\n=== comparação com a base ===');
    console.log(`casos comparados: ${counted}`);
    console.log(`passou a funcionar: ${improved.length ? improved.join(', ') : 'nenhum'}`);
    console.log(`passou a falhar: ${regressed.length ? regressed.join(', ') : 'nenhum'}`);
    console.log(
      `taxa de acerto: ${(base.passRate * 100).toFixed(0)}% -> ${(summary.passRate * 100).toFixed(0)}%`,
    );
    console.log(
      `latência média: ${base.latencyMs.mean} ms -> ${summary.latencyMs.mean} ms (${latencyDelta >= 0 ? '+' : ''}${Math.round(latencyDelta / Math.max(1, counted))} ms por caso)`,
    );
    console.log(`correções: ${base.retries} -> ${summary.retries}`);
  }
}

process.exitCode = summary.failures.length ? 1 : 0;
