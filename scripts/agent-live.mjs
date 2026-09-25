/**
 * Pedido real ao assistente em laço, fora da interface: cria um projeto num
 * banco temporário, roda o pedido e imprime as etapas, a resposta e o custo.
 *
 *   node --import tsx scripts/agent-live.mjs "pedido" [--model deepseek] [--template cozinha]
 */
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.MERCE_DATA_DIR = mkdtempSync(join(tmpdir(), 'merce-agent-live-'));
for (const line of readFileSync('.env', 'utf8').split(/\r?\n/)) {
  const m = /^(\w+)=(.*)$/.exec(line);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
}
const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : fallback;
};
const request = args.find((a, i) => !a.startsWith('--') && !args[i - 1]?.startsWith('--')) ?? 'Coloque um nicho de 60 cm à direita com duas portas e me mostre de frente';
const model = flag('model', 'deepseek');
const template = flag('template');

const { create, createFromTemplate, get, save } = await import('../lib/store.ts');
const { DEFAULT_PRICES, money, quote } = await import('../lib/quote.ts');
const { runAgentTurn } = await import('../lib/agent/turn.ts');
const { addUsage, emptyUsage, priceOf } = await import('../lib/models.ts');
const { generateDesign } = await import('../lib/studio.ts');

const p = get((template ? createFromTemplate(template) : create()).id);
const user = {
  id: 'u1',
  role: 'user',
  content: request,
  revisionId: p.revisions[p.cursor].id,
  revision: 1,
  context: { requestId: 'live', baseRevisionId: p.revisions[p.cursor].id, selectedPartIds: [], referencedPartIds: [] },
};
p.messages.push(user);
const version = save(p, p.version).version;
let usage = emptyUsage(model);
const price = priceOf(model, process.env);
const t0 = Date.now();
const r = await runAgentTurn({
  project: p,
  version,
  user,
  request,
  selected: [],
  ui: null,
  prices: structuredClone(DEFAULT_PRICES),
  model,
  requestId: 'live',
  started: t0,
  signal: new AbortController().signal,
  progress: () => {},
  emit: (e) => {
    const s = ((Date.now() - t0) / 1000).toFixed(1).padStart(5);
    if (e.type === 'step') console.log(`${s}s ${e.step.ok ? '✓' : '✗'} ${e.step.tool.padEnd(14)} ${e.step.label}${e.step.detail ? `  → ${e.step.detail.slice(0, 160)}` : ''}`);
    if (e.type === 'plan') console.log(`${s}s   plano: ${e.steps.join(' · ')}`);
    if (e.type === 'effect') console.log(`${s}s   efeito: ${JSON.stringify(e.effect).slice(0, 100)}`);
  },
  onUsage: (u) => {
    usage = addUsage(usage, u, price);
  },
  usage: () => ({ usage }),
});
const final = get(r.projectId);
const answer = final.messages.at(-1);
const q = quote(generateDesign(final.revisions[final.cursor].params).parts, final.revisions[final.cursor].params.modules.length, DEFAULT_PRICES);
console.log('\n' + answer.content);
console.log(`\n${answer.result.outcome} · ${final.revisions.length} versões · ${((Date.now() - t0) / 1000).toFixed(1)} s · ${usage.calls} chamadas · US$ ${usage.costUsd.toFixed(4)} · ${usage.inputTokens} tok entrada (${usage.cachedTokens} cache) · orçamento ${money(q.total)}`);
if (answer.suggestions?.length) console.log('sugestões:', answer.suggestions.join(' | '));
if (r.state.effects.length) console.log('efeitos:', JSON.stringify(r.state.effects));
if (r.state.viewAction) console.log('frentes:', JSON.stringify(r.state.viewAction));
console.log('módulos:', final.revisions[final.cursor].params.modules.map((m) => `${m.name} ${m.width}×${m.height}×${m.depth}`).join(' | '));
if (final.room) console.log('ambiente:', `${final.room.widthMm}×${final.room.heightMm}`, (final.room.obstacles ?? []).map((o) => `${o.label ?? o.kind} x ${o.xMm} y ${o.yMm} ${o.widthMm}×${o.heightMm}`).join(' | '));
