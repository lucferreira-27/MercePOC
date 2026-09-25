/**
 * Painel do benchmark (só para quem desenvolve): lê bench/results/*.json e
 * gera bench/results/painel.html, uma página única, sem servidor nem rede.
 *
 *   npm run bench:dash           # gera e mostra o caminho
 *
 * O runner (bench/run.mjs) chama buildDashboard() depois de gravar --out,
 * então o painel fica em dia a cada rodada. Rodadas antigas, sem os campos
 * label/provider/effort, têm esses dados deduzidos do nome do arquivo.
 */
import { readFileSync, readdirSync, writeFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const RESULTS = resolve('bench/results');
const OUT = join(RESULTS, 'painel.html');

/** Tabelas de preço (US$ por 1M: entrada, saída, cache lido) para recalcular o custo. */
const PRICES = {
  'deepseek@commandcode': [0.14, 0.56, 0.014],
  'deepseek@zen': [0.3, 1.2, 0.006],
  'luna@commandcode': [0.5, 2, 0.05],
  'luna@zen': [0.1, 0.5, 0.01],
  'mimo@commandcode': [0.14, 0.28, 0.0028],
};

function inferMeta(file, s) {
  const name = file.replace(/\.json$/, '');
  const model = s.model ?? (/luna/.test(name) ? 'luna' : /mimo/.test(name) ? 'mimo' : 'deepseek');
  const zen = /(^|-)zen/.test(name) || /opencode/.test(s.provider ?? '');
  const provider = s.provider ?? (zen ? 'opencode.ai' : 'api.commandcode.ai');
  const effort =
    s.effort ??
    /-(none|low|medium|high|xhigh|max)(-|$)/.exec(name)?.[1] ??
    (/^agente-zen|^zen-none/.test(name) ? 'none' : model === 'qwen-fast' ? null : 'low');
  const mode = s.offline ? 'offline' : s.agent || (s.results ?? []).some((r) => r.steps) ? 'laço' : 'legado';
  return {
    file: name,
    label: s.label ?? name,
    model,
    provider,
    providerKey: /opencode/.test(provider) ? 'zen' : /commandcode/.test(provider) ? 'commandcode' : provider,
    providerModel: s.providerModel ?? null,
    effort,
    mode,
    photoLoop: s.photoLoop ?? null,
    argv: s.argv ?? null,
  };
}

/** Só o que o painel usa: tira o design de prévia e as operações cruas. */
function slimResult(r) {
  const ops = r.decision?.ops ?? [];
  return {
    id: r.id,
    group: r.group,
    run: r.run,
    ok: r.ok,
    errors: r.errors ?? [],
    action: r.action,
    applied: r.applied,
    calls: r.calls ?? 0,
    retries: r.retries ?? 0,
    networkRetries: r.networkRetries ?? 0,
    latencyMs: r.latencyMs ?? 0,
    costUsd: r.costUsd ?? 0,
    tokens: r.tokens ?? { input: 0, cached: 0, output: 0 },
    message: r.decision?.message ?? '',
    suggestions: r.decision?.suggestions ?? [],
    opsCount: ops.length,
    opKinds: [...new Set(ops.map((o) => o.kind))],
    steps: (r.steps ?? []).map((s) =>
      typeof s === 'string' ? { tool: s.replace(/^✗/, ''), ok: !s.startsWith('✗'), label: '' } : s,
    ),
  };
}

export async function buildDashboard({ quiet = false } = {}) {
  const { cases, groups } = await import(pathToFileURL(resolve('bench/cases.mjs')).href);
  const runs = [];
  for (const file of readdirSync(RESULTS)) {
    if (!file.endsWith('.json')) continue;
    let s;
    try {
      s = JSON.parse(readFileSync(join(RESULTS, file), 'utf8'));
    } catch {
      continue;
    }
    if (!Array.isArray(s.results) || !s.results.length) continue;
    runs.push({
      ...inferMeta(file, s),
      at: s.at ?? statSync(join(RESULTS, file)).mtime.toISOString(),
      recordedPrice: s.price ?? null,
      results: s.results.map(slimResult),
    });
  }
  runs.sort((a, b) => (a.at < b.at ? 1 : -1));
  const caseInfo = Object.fromEntries(
    cases.map((c) => [
      c.id,
      { group: c.group, prompt: c.prompt, learned: c.learned ?? '', image: !!c.image, agentOnly: !!c.agentOnly },
    ]),
  );
  const data = { generatedAt: new Date().toISOString(), groups, cases: caseInfo, prices: PRICES, runs };
  const json = JSON.stringify(data).replace(/</g, '\\u003c');
  writeFileSync(OUT, PAGE.replace('__DATA__', json));
  if (!quiet) console.log(`painel: ${pathToFileURL(OUT).href} (${runs.length} rodadas)`);
  return OUT;
}

const PAGE = /* html */ `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Painel do bench</title>
<style>
:root {
  --bg: #f6f5f2; --panel: #fffdfa; --panel-2: #f1efea; --line: #e3ded4; --ink: #1d211e; --muted: #6b6960;
  --accent: #2f6b4f; --accent-soft: #e2eee6; --ok: #2f7a4f; --ok-soft: #e1f1e6; --bad: #b3412e; --bad-soft: #fbe7e2;
  --warn: #9a6516; --warn-soft: #fbefd9; --info: #2e5f8a; --info-soft: #e2edf7;
  --mono: ui-monospace, SFMono-Regular, Consolas, monospace;
}
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
    --bg: #141618; --panel: #1b1e21; --panel-2: #22262a; --line: #2e3338; --ink: #ecebe6; --muted: #9b988f;
    --accent: #5dbb8b; --accent-soft: #1f3329; --ok: #5dbb8b; --ok-soft: #1c3226; --bad: #ec7a66; --bad-soft: #3a211c;
    --warn: #e0a64a; --warn-soft: #3a2e19; --info: #7fb2e0; --info-soft: #1c2a38;
  }
}
:root[data-theme="dark"] {
  --bg: #141618; --panel: #1b1e21; --panel-2: #22262a; --line: #2e3338; --ink: #ecebe6; --muted: #9b988f;
  --accent: #5dbb8b; --accent-soft: #1f3329; --ok: #5dbb8b; --ok-soft: #1c3226; --bad: #ec7a66; --bad-soft: #3a211c;
  --warn: #e0a64a; --warn-soft: #3a2e19; --info: #7fb2e0; --info-soft: #1c2a38;
}
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--ink); font: 14px/1.45 system-ui, -apple-system, "Segoe UI", sans-serif; }
header { position: sticky; top: 0; z-index: 5; background: var(--panel); border-bottom: 1px solid var(--line); padding: 10px 20px; display: flex; gap: 16px; align-items: center; flex-wrap: wrap; }
header h1 { font-size: 16px; margin: 0; }
header small { color: var(--muted); }
nav { display: flex; gap: 4px; }
nav button, .chip, select, input[type=search] { font: inherit; }
nav button { border: 1px solid transparent; background: none; color: var(--muted); padding: 6px 12px; border-radius: 8px; cursor: pointer; }
nav button.on { background: var(--accent-soft); color: var(--accent); border-color: var(--line); font-weight: 600; }
.spacer { flex: 1; }
.ctl { display: flex; gap: 8px; align-items: center; color: var(--muted); font-size: 13px; }
select, input[type=search] { background: var(--panel-2); color: var(--ink); border: 1px solid var(--line); border-radius: 8px; padding: 5px 8px; }
main { padding: 16px 20px 60px; max-width: 1500px; margin: 0 auto; }
.card { background: var(--panel); border: 1px solid var(--line); border-radius: 12px; padding: 14px 16px; margin-bottom: 14px; overflow-x: auto; min-width: 0; }
.card h2 { font-size: 14px; margin: 0 0 10px; }
.card h2 small { font-weight: 400; color: var(--muted); margin-left: 6px; }
.grid2 { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(420px, 100%), 1fr)); gap: 14px; }
.grid2 > * { min-width: 0; }
.kpis { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 10px; margin-bottom: 14px; }
.kpi { background: var(--panel); border: 1px solid var(--line); border-radius: 12px; padding: 10px 12px; }
.kpi b { display: block; font-size: 20px; font-variant-numeric: tabular-nums; }
.kpi span { color: var(--muted); font-size: 12px; }
table { width: 100%; border-collapse: collapse; font-variant-numeric: tabular-nums; }
th, td { text-align: left; padding: 6px 8px; border-bottom: 1px solid var(--line); vertical-align: top; }
th { font-size: 12px; color: var(--muted); font-weight: 600; cursor: pointer; white-space: nowrap; user-select: none; }
th.num, td.num { text-align: right; white-space: nowrap; }
tbody tr:hover { background: var(--panel-2); }
tr.click { cursor: pointer; }
.pill { display: inline-block; padding: 1px 8px; border-radius: 999px; font-size: 12px; font-weight: 600; white-space: nowrap; }
.pill.ok { background: var(--ok-soft); color: var(--ok); }
.pill.bad { background: var(--bad-soft); color: var(--bad); }
.pill.warn { background: var(--warn-soft); color: var(--warn); }
.pill.info { background: var(--info-soft); color: var(--info); }
.pill.mute { background: var(--panel-2); color: var(--muted); }
.muted { color: var(--muted); }
.mono { font-family: var(--mono); font-size: 12px; }
.bar { height: 8px; background: var(--panel-2); border-radius: 4px; overflow: hidden; min-width: 80px; }
.bar i { display: block; height: 100%; background: var(--ok); }
.detail { background: var(--panel-2); }
.detail td { padding: 12px 14px; }
.steps { display: flex; flex-wrap: wrap; gap: 4px; margin: 6px 0; }
.step { font-family: var(--mono); font-size: 11.5px; padding: 2px 6px; border-radius: 6px; background: var(--panel); border: 1px solid var(--line); }
.step.bad { border-color: var(--bad); color: var(--bad); }
.kv { display: grid; grid-template-columns: 140px 1fr; gap: 4px 12px; margin: 0; }
.kv dt { color: var(--muted); }
.kv dd { margin: 0; white-space: pre-wrap; }
.errors li { color: var(--bad); }
.chips { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 10px; }
.chip { border: 1px solid var(--line); background: var(--panel); color: var(--ink); border-radius: 999px; padding: 3px 10px; cursor: pointer; font-size: 12.5px; }
.chip.on { background: var(--accent-soft); border-color: var(--accent); color: var(--accent); }
.cell { display: inline-block; min-width: 46px; text-align: center; border-radius: 6px; padding: 1px 4px; font-size: 12px; }
.cell.ok { background: var(--ok-soft); color: var(--ok); }
.cell.bad { background: var(--bad-soft); color: var(--bad); font-weight: 600; }
.cell.none { color: var(--muted); }
.diffrow td:first-child { box-shadow: inset 3px 0 var(--warn); }
svg text { fill: var(--muted); font-size: 11px; }
svg .axis { stroke: var(--line); }
.empty { color: var(--muted); padding: 20px; text-align: center; }
.note { font-size: 12px; color: var(--muted); margin-top: 6px; }
.toolbar { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; margin-bottom: 10px; }
@media (max-width: 700px) { main { padding: 12px; } .grid2 { grid-template-columns: 1fr; } .kv { grid-template-columns: 1fr; } }
</style>
</head>
<body>
<header>
  <h1>Painel do bench</h1>
  <small id="gen"></small>
  <nav id="tabs"></nav>
  <div class="spacer"></div>
  <label class="ctl">Preço como
    <select id="price">
      <option value="recorded">do provedor da rodada</option>
      <option value="commandcode">Command Code</option>
      <option value="zen">OpenCode Zen</option>
    </select>
  </label>
  <label class="ctl">Modo
    <select id="mode">
      <option value="">todos</option>
      <option value="laço">laço</option>
      <option value="legado">legado</option>
      <option value="offline">offline</option>
    </select>
  </label>
  <label class="ctl"><input type="checkbox" id="partial"> parciais</label>
  <button class="chip" id="theme" title="Tema">◐</button>
</header>
<main id="app"></main>
<script id="data" type="application/json">__DATA__</script>
<script>
const D = JSON.parse(document.getElementById('data').textContent);
const $ = (s, el = document) => el.querySelector(s);
const esc = (v) => String(v ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const store = {
  get(k, d) { try { const v = localStorage.getItem('bench.' + k); return v === null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem('bench.' + k, JSON.stringify(v)); } catch {} },
};
const S = {
  tab: store.get('tab', 'rodadas'),
  run: store.get('run', D.runs[0]?.file),
  compare: store.get('compare', D.runs.slice(0, 2).map((r) => r.file)),
  price: store.get('price', 'recorded'),
  partial: store.get('partial', false),
  mode: store.get('mode', ''),
  onlyFail: false, group: '', q: '', sort: null, open: new Set(), reason: '',
};
const FULL = 40;
const isFull = (r) => r.results.length >= FULL;
const visibleRuns = () => D.runs.filter((r) => (S.partial || isFull(r)) && (!S.mode || r.mode === S.mode));

// Rodada sem nenhum token de cache informado (provedor que não informa): o
// custo usa a fração de cache medida nas rodadas do laço que informam, com "≈".
const cacheUnknown = (run) => run.mode === 'laço' && run.results.some((r) => r.tokens?.input > 0) && run.results.every((r) => !(r.tokens?.cached > 0));
const CACHE_RATIO = (() => {
  let inp = 0, cached = 0;
  for (const run of D.runs) if (run.mode === 'laço' && !cacheUnknown(run)) for (const r of run.results) { inp += r.tokens?.input || 0; cached += r.tokens?.cached || 0; }
  return inp ? cached / inp : 0;
})();
const byFile = (f) => D.runs.find((r) => r.file === f);

// ---- números
const sum = (a, f) => a.reduce((s, x) => s + f(x), 0);
const pct = (a, p) => { if (!a.length) return 0; const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };
const sec = (ms) => (ms / 1000).toFixed(ms < 10000 ? 1 : 0) + ' s';
const usd = (v) => 'US$ ' + (v < 0.01 ? v.toFixed(4) : v < 1 ? v.toFixed(3) : v.toFixed(2));
const k = (n) => (n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1e3 ? (n / 1e3).toFixed(n >= 1e4 ? 0 : 1) + 'k' : String(n));
/** Tabela para recalcular pelos tokens; sem tabela conhecida, vale o custo gravado pelo runner. */
function priceFor(run) {
  return D.prices[run.model + '@' + (S.price === 'recorded' ? run.providerKey : S.price)] ?? null;
}
function costOf(run, r) {
  const t = r.tokens || {};
  const guess = cacheUnknown(run);
  const p = priceFor(run);
  if (!p) return r.costUsd;
  const cached = guess ? (t.input || 0) * CACHE_RATIO : t.cached || 0;
  return (((t.input || 0) - cached) * p[0] + cached * p[2] + (t.output || 0) * p[1]) / 1e6;
}
const approx = (run) => (cacheUnknown(run) ? '≈' : '');
function stats(run) {
  const x = run.results;
  const ms = x.map((r) => r.latencyMs);
  const cost = sum(x, (r) => costOf(run, r));
  return {
    n: x.length, ok: x.filter((r) => r.ok).length,
    med: pct(ms, 0.5), p90: pct(ms, 0.9), max: Math.max(0, ...ms), mean: sum(x, (r) => r.latencyMs) / (x.length || 1),
    cost, costCase: cost / (x.length || 1),
    out: sum(x, (r) => r.tokens?.output || 0), inp: sum(x, (r) => r.tokens?.input || 0), cached: sum(x, (r) => r.tokens?.cached || 0),
    calls: sum(x, (r) => r.calls) / (x.length || 1),
    provErr: x.filter((r) => reasonOf(r) === 'Provedor').length,
    cacheRate: sum(x, (r) => r.tokens?.cached || 0) / (sum(x, (r) => r.tokens?.input || 0) || 1),
  };
}

// ---- por que falhou
const REASONS = [
  ['Provedor', /\\b(429|503|502|504)\\b|provedor|conexão com a IA|Insufficient|Endpoint is unavailable|rate/i],
  ['Harness', /exceção|sem fixture|gravação acabou|preparação falhou/i],
  ['Ação errada', /ação .* fora do esperado|não criou revisão|criou revisão|não pediu esclarecimento/i],
  ['Resposta', /resposta não citou|resposta trouxe/i],
  ['Sugestões', /sugest/i],
];
function reasonOf(r) {
  if (r.ok) return '';
  const t = r.errors.join(' | ');
  for (const [name, re] of REASONS) if (re.test(t)) return name;
  return 'Resultado do móvel';
}
const REASON_TONE = { Provedor: 'info', Harness: 'warn', 'Ação errada': 'bad', Resposta: 'bad', Sugestões: 'warn', 'Resultado do móvel': 'bad' };

function runTags(run) {
  const tags = [
    '<span class="pill mute">' + esc(run.model) + '</span>',
    '<span class="pill ' + (run.providerKey === 'zen' ? 'info' : 'mute') + '">' + esc(run.providerKey === 'zen' ? 'Zen' : run.providerKey === 'commandcode' ? 'Command Code' : run.provider) + '</span>',
  ];
  if (run.effort) tags.push('<span class="pill ' + (run.effort === 'none' ? 'warn' : 'mute') + '">' + esc(run.effort) + '</span>');
  tags.push('<span class="pill ' + (run.mode === 'laço' ? 'ok' : run.mode === 'offline' ? 'mute' : 'warn') + '">' + esc(run.mode) + '</span>');
  if (!isFull(run)) tags.push('<span class="pill mute">parcial</span>');
  return tags.join(' ');
}

// ---- gráficos (SVG)
function scatter(runs, xf, xlabel, fmtX) {
  const W = 560, H = 260, L = 44, B = 32, T = 10, R = 12;
  const pts = runs.map((r) => ({ r, s: stats(r) })).map((p) => ({ ...p, x: xf(p.s), y: p.s.ok / p.s.n }));
  if (!pts.length) return '<div class="empty">Sem rodadas completas.</div>';
  const xs = pts.map((p) => p.x), maxX = Math.max(...xs) * 1.1 || 1;
  const minY = Math.min(0.7, ...pts.map((p) => p.y)) - 0.02;
  const X = (v) => L + (v / maxX) * (W - L - R), Y = (v) => T + (1 - (v - minY) / (1 - minY)) * (H - T - B);
  let g = '<svg viewBox="0 0 ' + W + ' ' + H + '" width="100%" role="img">';
  for (let i = 0; i <= 4; i++) {
    const v = minY + ((1 - minY) * i) / 4;
    g += '<line class="axis" x1="' + L + '" x2="' + (W - R) + '" y1="' + Y(v) + '" y2="' + Y(v) + '"/><text x="' + (L - 6) + '" y="' + (Y(v) + 4) + '" text-anchor="end">' + Math.round(v * 100) + '%</text>';
  }
  for (let i = 0; i <= 4; i++) {
    const v = (maxX * i) / 4;
    g += '<text x="' + X(v) + '" y="' + (H - 16) + '" text-anchor="' + (i === 4 ? 'end' : i === 0 ? 'start' : 'middle') + '">' + fmtX(v) + '</text>';
  }
  g += '<text x="' + (W - R) + '" y="' + (H - 1) + '" text-anchor="end">' + esc(xlabel) + ' →</text>';
  // Rótulo só onde não cobre outro (as rodadas mais novas primeiro); o resto
  // aparece ao passar o mouse.
  const placed = pts.map((p) => ({ x: X(p.x) - 6, y: Y(p.y) - 6, w: 12, h: 12 }));
  const order = [...pts].sort((a, b) => (a.r.at < b.r.at ? 1 : -1));
  for (const p of order) {
    const c = p.r.model === 'luna' ? 'var(--info)' : p.r.model === 'deepseek' ? 'var(--accent)' : 'var(--warn)';
    const text = p.r.label.slice(0, 26), w = text.length * 6.2, x0 = X(p.x) + 8;
    const flip = x0 + w > W - R;
    const box = { x: flip ? X(p.x) - 8 - w : x0, y: Y(p.y) - 8, w, h: 14 };
    const own = (b) => b.w === 12 && Math.abs(b.x + 6 - X(p.x)) < 0.01 && Math.abs(b.y + 6 - Y(p.y)) < 0.01;
    const free = !placed.some((b) => !own(b) && box.x < b.x + b.w && b.x < box.x + box.w && box.y < b.y + b.h && b.y < box.y + box.h);
    if (free) placed.push(box);
    g += '<g class="pt" data-file="' + esc(p.r.file) + '" style="cursor:pointer"><circle cx="' + X(p.x) + '" cy="' + Y(p.y) + '" r="6" fill="' + c + '" fill-opacity=".8"><title>' + esc(p.r.label) + '\\n' + p.s.ok + '/' + p.s.n + ' · ' + fmtX(p.x) + '</title></circle>' +
      (free ? '<text x="' + (flip ? X(p.x) - 8 : x0) + '" y="' + (Y(p.y) + 4) + '"' + (flip ? ' text-anchor="end"' : '') + '>' + esc(text) + '</text>' : '') + '</g>';
  }
  return g + '</svg><div class="note">Verde: DeepSeek · azul: Luna · âmbar: outros. Canto de cima à esquerda é melhor.</div>';
}
function latencyBars(run) {
  const x = [...run.results].sort((a, b) => a.latencyMs - b.latencyMs);
  const W = 720, H = 160, L = 36, B = 18, T = 10, max = Math.max(1, ...x.map((r) => r.latencyMs));
  const bw = (W - L) / x.length;
  let g = '<svg viewBox="0 0 ' + W + ' ' + H + '" width="100%" role="img">';
  for (const v of [0.25, 0.5, 0.75, 1]) {
    const y = T + (H - B - T) * (1 - v);
    g += '<line class="axis" x1="' + L + '" x2="' + W + '" y1="' + y + '" y2="' + y + '"/><text x="' + (L - 4) + '" y="' + (y + 4) + '" text-anchor="end">' + Math.round((max * v) / 1000) + 's</text>';
  }
  x.forEach((r, i) => {
    const h = ((H - B - T) * r.latencyMs) / max;
    g += '<rect x="' + (L + i * bw + 1) + '" y="' + (H - B - h) + '" width="' + Math.max(1, bw - 2) + '" height="' + h + '" fill="' + (r.ok ? 'var(--ok)' : 'var(--bad)') + '" fill-opacity=".75"><title>' + esc(r.id) + ' · ' + sec(r.latencyMs) + (r.ok ? '' : ' · falhou') + '</title></rect>';
  });
  return g + '</svg><div class="note">Cada barra é um caso, do mais rápido ao mais lento. Vermelho: falhou.</div>';
}

// ---- abas
const TABS = [['rodadas', 'Rodadas'], ['rodada', 'Rodada'], ['comparar', 'Comparar'], ['casos', 'Casos']];
function renderTabs() {
  $('#tabs').innerHTML = TABS.map(([id, t]) => '<button class="' + (S.tab === id ? 'on' : '') + '" data-tab="' + id + '">' + t + '</button>').join('');
}
function render() {
  store.set('tab', S.tab); store.set('run', S.run); store.set('compare', S.compare); store.set('price', S.price); store.set('partial', S.partial); store.set('mode', S.mode);
  renderTabs();
  $('#price').value = S.price; $('#partial').checked = S.partial; $('#mode').value = S.mode;
  const app = $('#app');
  if (!D.runs.length) { app.innerHTML = '<div class="empty">Nenhum resultado em bench/results. Rode npm run bench -- --out bench/results/x.json.</div>'; return; }
  app.innerHTML = S.tab === 'rodada' ? viewRun() : S.tab === 'comparar' ? viewCompare() : S.tab === 'casos' ? viewCases() : viewRuns();
}

function viewRuns() {
  const runs = visibleRuns();
  const cols = [
    ['label', 'Rodada'], ['at', 'Quando'], ['ok', 'Acerto', 1], ['med', 'Mediana', 1], ['p90', 'p90', 1], ['max', 'Máx', 1],
    ['costCase', 'Custo/caso', 1], ['cost', 'Custo total', 1], ['cacheRate', 'Cache', 1], ['out', 'Saída tok', 1], ['calls', 'Chamadas/caso', 1], ['provErr', 'Erros prov.', 1],
  ];
  const rows = runs.map((r) => ({ r, s: stats(r) }));
  const sort = S.sort && S.sort.view === 'runs' ? S.sort : null;
  if (sort) rows.sort((a, b) => {
    const va = sort.key === 'label' ? a.r.label : sort.key === 'at' ? a.r.at : sort.key === 'ok' ? a.s.ok / a.s.n : a.s[sort.key];
    const vb = sort.key === 'label' ? b.r.label : sort.key === 'at' ? b.r.at : sort.key === 'ok' ? b.s.ok / b.s.n : b.s[sort.key];
    return (va < vb ? -1 : va > vb ? 1 : 0) * sort.dir;
  });
  let h = '<div class="grid2"><div class="card"><h2>Qualidade × custo por caso<small>rodadas completas</small></h2>' + scatter(runs.filter(isFull), (s) => s.costCase, 'custo por caso', (v) => '$' + v.toFixed(v < 0.01 ? 4 : 3)) + '</div>' +
    '<div class="card"><h2>Qualidade × tempo mediano<small>rodadas completas</small></h2>' + scatter(runs.filter(isFull), (s) => s.med, 'mediana', (v) => (v / 1000).toFixed(0) + 's') + '</div></div>';
  h += '<div class="card"><h2>Rodadas<small>' + runs.length + ' · clique para abrir · marque para comparar</small></h2><table><thead><tr><th></th>' +
    cols.map(([key, t, num]) => '<th class="' + (num ? 'num' : '') + '" data-sort="runs:' + key + '">' + t + (sort && sort.key === key ? (sort.dir > 0 ? ' ▲' : ' ▼') : '') + '</th>').join('') + '</tr></thead><tbody>';
  for (const { r, s } of rows) {
    const rate = s.ok / s.n;
    h += '<tr class="click" data-open="' + esc(r.file) + '"><td><input type="checkbox" data-cmp="' + esc(r.file) + '"' + (S.compare.includes(r.file) ? ' checked' : '') + '></td>' +
      '<td><b>' + esc(r.label) + '</b><div>' + runTags(r) + '</div></td>' +
      '<td class="muted">' + esc(r.at.slice(0, 16).replace('T', ' ')) + '</td>' +
      '<td class="num"><b>' + s.ok + '/' + s.n + '</b><div class="bar"><i style="width:' + (rate * 100).toFixed(0) + '%;background:' + (rate >= 0.95 ? 'var(--ok)' : rate >= 0.85 ? 'var(--warn)' : 'var(--bad)') + '"></i></div></td>' +
      '<td class="num">' + sec(s.med) + '</td><td class="num">' + sec(s.p90) + '</td><td class="num">' + sec(s.max) + '</td>' +
      '<td class="num">' + approx(r) + usd(s.costCase) + '</td><td class="num">' + approx(r) + usd(s.cost) + '</td><td class="num">' + (s.inp ? Math.round(s.cacheRate * 100) + '%' : '—') + '</td><td class="num">' + k(s.out) + '</td>' +
      '<td class="num">' + s.calls.toFixed(1) + '</td><td class="num">' + (s.provErr ? '<span class="pill info">' + s.provErr + '</span>' : '<span class="muted">0</span>') + '</td></tr>';
  }
  h += '</tbody></table><div class="note">Custo recalculado pelos tokens com a tabela de preço escolhida em "Preço como" (padrão: a do provedor de cada rodada). Cache: o custo depende muito da fração da entrada lida do cache (no Zen, US$ 0,006/M em cache contra US$ 0,30/M fora); a coluna Cache mostra quanto de cada rodada veio do cache. ≈: rodada sem cache informado, estimada com ' + Math.round(CACHE_RATIO * 100) + '%.</div></div>';
  return h;
}

function viewRun() {
  const run = byFile(S.run) || D.runs[0];
  S.run = run.file;
  const s = stats(run);
  const groups = {};
  for (const r of run.results) { const g = (groups[r.group] ??= { n: 0, ok: 0, ms: [] }); g.n++; if (r.ok) g.ok++; g.ms.push(r.latencyMs); }
  const reasons = {};
  for (const r of run.results) { const why = reasonOf(r); if (why) (reasons[why] ??= []).push(r.id); }
  let h = '<div class="toolbar"><select id="runpick">' + D.runs.map((r) => '<option value="' + esc(r.file) + '"' + (r.file === run.file ? ' selected' : '') + '>' + esc(r.label) + ' (' + r.results.length + ')</option>').join('') + '</select> ' + runTags(run) +
    (run.argv ? ' <span class="mono muted">' + esc(run.argv) + '</span>' : '') + '</div>';
  h += '<div class="kpis">' + [
    [s.ok + '/' + s.n, 'acerto (' + Math.round((s.ok / s.n) * 100) + '%)'], [sec(s.med), 'mediana'], [sec(s.p90), 'p90'], [sec(s.max), 'máximo'],
    [approx(run) + usd(s.cost), 'custo total' + (approx(run) ? ' (cache estimado)' : '')], [approx(run) + usd(s.costCase), 'custo por caso'], [k(s.out), 'tokens de saída'], [k(s.inp) + (s.cached ? ' (' + Math.round((s.cached / s.inp) * 100) + '% cache)' : ''), 'tokens de entrada'],
    [s.calls.toFixed(1), 'chamadas por caso'], [String(s.provErr), 'erros de provedor'],
  ].map(([v, t]) => '<div class="kpi"><b>' + v + '</b><span>' + t + '</span></div>').join('') + '</div>';
  h += '<div class="grid2"><div class="card"><h2>Por grupo</h2><table><thead><tr><th>Grupo</th><th class="num">Acerto</th><th></th><th class="num">Mediana</th></tr></thead><tbody>' +
    Object.entries(groups).map(([g, v]) => '<tr class="click" data-group="' + esc(g) + '"><td><b>' + esc(g) + '</b><div class="muted" style="font-size:12px">' + esc(D.groups[g] || '') + '</div></td><td class="num">' + v.ok + '/' + v.n + '</td><td style="width:30%"><div class="bar"><i style="width:' + ((v.ok / v.n) * 100).toFixed(0) + '%;background:' + (v.ok === v.n ? 'var(--ok)' : 'var(--bad)') + '"></i></div></td><td class="num">' + sec(pct(v.ms, 0.5)) + '</td></tr>').join('') +
    '</tbody></table></div><div><div class="card"><h2>Por que falhou<small>clique para filtrar</small></h2>' +
    (Object.keys(reasons).length ? '<div class="chips">' + Object.entries(reasons).map(([why, ids]) => '<button class="chip' + (S.reason === why ? ' on' : '') + '" data-reason="' + esc(why) + '"><span class="pill ' + (REASON_TONE[why] || 'bad') + '">' + ids.length + '</span> ' + esc(why) + '</button>').join('') + '</div>' +
      Object.entries(reasons).map(([why, ids]) => '<div style="margin:4px 0"><b>' + esc(why) + ':</b> <span class="mono">' + ids.map(esc).join(', ') + '</span></div>').join('') : '<div class="empty">Nenhuma falha.</div>') +
    '</div><div class="card"><h2>Tempo por caso</h2>' + latencyBars(run) + '</div></div></div>';
  h += caseTable(run);
  return h;
}

function caseTable(run) {
  let x = run.results;
  if (S.onlyFail) x = x.filter((r) => !r.ok);
  if (S.group) x = x.filter((r) => r.group === S.group);
  if (S.reason) x = x.filter((r) => reasonOf(r) === S.reason);
  if (S.q) { const q = S.q.toLowerCase(); x = x.filter((r) => (r.id + ' ' + (D.cases[r.id]?.prompt || '') + ' ' + r.message + ' ' + r.errors.join(' ')).toLowerCase().includes(q)); }
  const sort = S.sort && S.sort.view === 'cases' ? S.sort : null;
  if (sort) x = [...x].sort((a, b) => { const f = (r) => (sort.key === 'cost' ? costOf(run, r) : sort.key === 'out' ? r.tokens?.output || 0 : r[sort.key]); return (f(a) < f(b) ? -1 : f(a) > f(b) ? 1 : 0) * sort.dir; });
  let h = '<div class="card"><h2>Casos<small>' + x.length + ' de ' + run.results.length + ' · clique numa linha para ver etapas, resposta e erros</small></h2><div class="toolbar">' +
    '<label class="ctl"><input type="checkbox" id="onlyfail"' + (S.onlyFail ? ' checked' : '') + '> só falhas</label>' +
    '<select id="grp"><option value="">todos os grupos</option>' + Object.keys(D.groups).map((g) => '<option' + (S.group === g ? ' selected' : '') + '>' + esc(g) + '</option>').join('') + '</select>' +
    '<input type="search" id="q" placeholder="buscar id, pedido, erro…" value="' + esc(S.q) + '">' +
    (S.reason ? '<button class="chip on" data-reason="' + esc(S.reason) + '">motivo: ' + esc(S.reason) + ' ✕</button>' : '') + '</div>';
  const th = (key, t, num) => '<th class="' + (num ? 'num' : '') + '" data-sort="cases:' + key + '">' + t + (sort && sort.key === key ? (sort.dir > 0 ? ' ▲' : ' ▼') : '') + '</th>';
  h += '<table><thead><tr>' + th('id', 'Caso') + th('ok', 'Resultado') + '<th>Pedido</th>' + th('action', 'Ação') + th('latencyMs', 'Tempo', 1) + th('calls', 'Chamadas', 1) + th('out', 'Saída tok', 1) + th('cost', 'Custo', 1) + '</tr></thead><tbody>';
  for (const r of x) {
    const key = run.file + ':' + r.id + ':' + r.run;
    const why = reasonOf(r);
    h += '<tr class="click" data-case="' + esc(key) + '"><td class="mono"><b>' + esc(r.id) + '</b><div class="muted">' + esc(r.group) + '</div></td>' +
      '<td>' + (r.ok ? '<span class="pill ok">ok</span>' : '<span class="pill ' + (REASON_TONE[why] || 'bad') + '">' + esc(why) + '</span>') + '</td>' +
      '<td>' + esc((D.cases[r.id]?.prompt || '').slice(0, 110)) + (r.ok ? '' : '<div style="color:var(--bad);font-size:12.5px">' + esc(r.errors.join(' | ').slice(0, 200)) + '</div>') + '</td>' +
      '<td class="mono">' + esc(r.action || '') + '</td><td class="num">' + sec(r.latencyMs) + '</td><td class="num">' + r.calls + '</td><td class="num">' + k(r.tokens?.output || 0) + '</td><td class="num">' + usd(costOf(run, r)) + '</td></tr>';
    if (S.open.has(key)) h += '<tr class="detail"><td colspan="8">' + caseDetail(run, r) + '</td></tr>';
  }
  if (!x.length) h += '<tr><td colspan="8" class="empty">Nada com esses filtros.</td></tr>';
  return h + '</tbody></table></div>';
}

function caseDetail(run, r) {
  const c = D.cases[r.id] || {};
  const t = r.tokens || {};
  let h = '<dl class="kv">';
  h += '<dt>Pedido</dt><dd>' + esc(c.prompt) + (c.image ? ' <span class="pill info">foto</span>' : '') + '</dd>';
  if (r.errors.length) h += '<dt>Por que falhou</dt><dd><ul class="errors" style="margin:0;padding-left:18px">' + r.errors.map((e) => '<li>' + esc(e) + '</li>').join('') + '</ul></dd>';
  if (r.steps.length) h += '<dt>Etapas</dt><dd><div class="steps">' + r.steps.map((s, i) => '<span class="step' + (s.ok ? '' : ' bad') + '" title="' + esc((s.label || '') + (s.detail ? '\\n' + s.detail : '')) + '">' + (i + 1) + '. ' + esc(s.tool) + (s.ok ? '' : ' ✗') + '</span>').join('') + '</div>' +
    r.steps.filter((s) => !s.ok && s.detail).map((s) => '<div style="color:var(--bad);font-size:12.5px">' + esc(s.tool) + ': ' + esc(s.detail) + '</div>').join('') + '</dd>';
  else if (r.opsCount) h += '<dt>Operações</dt><dd class="mono">' + r.opsCount + ' · ' + esc(r.opKinds.join(', ')) + '</dd>';
  h += '<dt>Resposta</dt><dd>' + esc(r.message || '—') + '</dd>';
  if (r.suggestions.length) h += '<dt>Sugestões</dt><dd>' + r.suggestions.map(esc).join(' · ') + '</dd>';
  h += '<dt>Números</dt><dd class="mono">ação ' + esc(r.action) + (r.applied ? ' (nova versão)' : '') + ' · ' + sec(r.latencyMs) + ' · ' + r.calls + ' chamadas' + (r.retries ? ' · ' + r.retries + ' correções' : '') + (r.networkRetries ? ' · ' + r.networkRetries + ' repetições de rede' : '') +
    ' · entrada ' + k(t.input || 0) + ' (' + k(t.cached || 0) + ' cache) · saída ' + k(t.output || 0) + ' · ' + usd(costOf(run, r)) + '</dd>';
  if (c.learned) h += '<dt>Por que existe</dt><dd class="muted">' + esc(c.learned) + '</dd>';
  const others = D.runs.filter((o) => o !== run && isFull(o)).map((o) => ({ o, r: o.results.find((v) => v.id === r.id) })).filter((v) => v.r).slice(0, 12);
  if (others.length) h += '<dt>Em outras rodadas</dt><dd>' + others.map(({ o, r: v }) => '<span class="cell ' + (v.ok ? 'ok' : 'bad') + '" title="' + esc(o.label + ' · ' + sec(v.latencyMs) + (v.ok ? '' : ' · ' + v.errors.join(' | '))) + '">' + esc(o.label.slice(0, 18)) + '</span>').join(' ') + '</dd>';
  return h + '</dl>';
}

function viewCompare() {
  const runs = S.compare.map(byFile).filter(Boolean);
  let h = '<div class="toolbar"><span class="muted">Marque as rodadas na aba Rodadas. A primeira é a base.</span></div>';
  if (runs.length < 2) return h + '<div class="card empty">Escolha pelo menos duas rodadas na aba Rodadas.</div>';
  const st = runs.map(stats);
  h += '<div class="card"><h2>Resumo</h2><table><thead><tr><th>Rodada</th><th class="num">Acerto</th><th class="num">Mediana</th><th class="num">p90</th><th class="num">Custo/caso</th><th class="num">Saída tok</th><th class="num">vs base</th></tr></thead><tbody>';
  const base = runs[0];
  runs.forEach((r, i) => {
    const s = st[i];
    let delta = '';
    if (i > 0) {
      const better = [], worse = [];
      for (const b of base.results) { const v = r.results.find((x) => x.id === b.id); if (!v) continue; if (!b.ok && v.ok) better.push(b.id); if (b.ok && !v.ok) worse.push(b.id); }
      delta = '<span class="pill ok" title="' + esc(better.join(', ')) + '">+' + better.length + '</span> <span class="pill bad" title="' + esc(worse.join(', ')) + '">−' + worse.length + '</span>';
    }
    h += '<tr><td><b>' + esc(r.label) + '</b><div>' + runTags(r) + '</div></td><td class="num">' + s.ok + '/' + s.n + '</td><td class="num">' + sec(s.med) + '</td><td class="num">' + sec(s.p90) + '</td><td class="num">' + approx(r) + usd(s.costCase) + '</td><td class="num">' + k(s.out) + '</td><td class="num">' + (i ? delta : '<span class="muted">base</span>') + '</td></tr>';
  });
  h += '</tbody></table></div>';
  const ids = [...new Set(runs.flatMap((r) => r.results.map((x) => x.id)))];
  const rows = ids.map((id) => ({ id, cells: runs.map((r) => r.results.find((x) => x.id === id)) }));
  const differs = (row) => new Set(row.cells.map((c) => (c ? c.ok : null))).size > 1;
  const shown = S.onlyFail ? rows.filter(differs) : rows;
  h += '<div class="card"><h2>Caso a caso<small>' + rows.filter(differs).length + ' casos mudam entre as rodadas</small></h2><div class="toolbar"><label class="ctl"><input type="checkbox" id="onlyfail"' + (S.onlyFail ? ' checked' : '') + '> só os que mudam</label></div>' +
    '<table><thead><tr><th>Caso</th>' + runs.map((r) => '<th class="num" title="' + esc(r.label) + '">' + esc(r.label.slice(0, 22)) + '</th>').join('') + '</tr></thead><tbody>';
  for (const row of shown) {
    h += '<tr class="' + (differs(row) ? 'diffrow' : '') + '"><td class="mono"><b>' + esc(row.id) + '</b> <span class="muted">' + esc((D.cases[row.id]?.prompt || '').slice(0, 60)) + '</span></td>' +
      row.cells.map((c) => '<td class="num">' + (c ? '<span class="cell ' + (c.ok ? 'ok' : 'bad') + '" title="' + esc(c.ok ? '' : c.errors.join(' | ')) + '">' + (c.ok ? '✓' : '✗') + ' ' + sec(c.latencyMs) + '</span>' : '<span class="cell none">—</span>') + '</td>').join('') + '</tr>';
  }
  return h + '</tbody></table></div>';
}

function viewCases() {
  const runs = visibleRuns().filter(isFull);
  const rows = Object.entries(D.cases).map(([id, c]) => {
    const seen = runs.map((r) => ({ r, v: r.results.find((x) => x.id === id) })).filter((x) => x.v);
    const fails = seen.filter((x) => !x.v.ok);
    let flips = 0;
    const chron = [...seen].sort((a, b) => (a.r.at < b.r.at ? -1 : 1));
    for (let i = 1; i < chron.length; i++) if (chron[i].v.ok !== chron[i - 1].v.ok) flips++;
    return { id, c, seen, fails, flips, med: pct(seen.map((x) => x.v.latencyMs), 0.5) };
  }).filter((x) => x.seen.length);
  rows.sort((a, b) => b.fails.length / b.seen.length - a.fails.length / a.seen.length || b.flips - a.flips);
  let h = '<div class="card"><h2>Casos em todas as rodadas completas<small>' + runs.length + ' rodadas · os que mais falham primeiro</small></h2><table><thead><tr><th>Caso</th><th>Pedido</th><th class="num">Falhou</th><th></th><th class="num">Instável</th><th class="num">Mediana</th><th>Onde falhou</th></tr></thead><tbody>';
  for (const x of rows) {
    const rate = x.fails.length / x.seen.length;
    h += '<tr><td class="mono"><b>' + esc(x.id) + '</b><div class="muted">' + esc(x.c.group) + '</div></td><td>' + esc(x.c.prompt.slice(0, 90)) + '</td><td class="num">' + x.fails.length + '/' + x.seen.length + '</td>' +
      '<td style="width:12%"><div class="bar"><i style="width:' + (rate * 100).toFixed(0) + '%;background:var(--bad)"></i></div></td>' +
      '<td class="num">' + (x.flips ? '<span class="pill warn">' + x.flips + '</span>' : '<span class="muted">0</span>') + '</td><td class="num">' + sec(x.med) + '</td>' +
      '<td>' + x.fails.slice(0, 6).map((f) => '<span class="cell bad" title="' + esc(f.v.errors.join(' | ')) + '">' + esc(f.r.label.slice(0, 16)) + '</span>').join(' ') + '</td></tr>';
  }
  return h + '</tbody></table><div class="note">Instável: quantas vezes o caso trocou de resultado entre rodadas seguidas (ordem de data). Passe o mouse para ver o motivo.</div></div>';
}

// ---- eventos
document.addEventListener('click', (e) => {
  const t = e.target.closest('[data-tab],[data-open],[data-cmp],[data-case],[data-sort],[data-reason],[data-group],.pt,#theme');
  if (!t) return;
  if (t.dataset.cmp !== undefined) {
    e.stopPropagation();
    const f = t.dataset.cmp;
    S.compare = t.checked ? [...S.compare.filter((x) => x !== f), f] : S.compare.filter((x) => x !== f);
    store.set('compare', S.compare);
    return;
  }
  if (t.id === 'theme') {
    const cur = document.documentElement.dataset.theme;
    const next = cur === 'dark' ? 'light' : cur === 'light' ? '' : 'dark';
    if (next) document.documentElement.dataset.theme = next; else delete document.documentElement.dataset.theme;
    store.set('theme', next);
    return;
  }
  if (t.dataset.tab) S.tab = t.dataset.tab;
  else if (t.classList.contains('pt')) { S.run = t.dataset.file; S.tab = 'rodada'; }
  else if (t.dataset.open) { S.run = t.dataset.open; S.tab = 'rodada'; S.group = ''; S.reason = ''; }
  else if (t.dataset.case) { S.open.has(t.dataset.case) ? S.open.delete(t.dataset.case) : S.open.add(t.dataset.case); }
  else if (t.dataset.reason !== undefined) S.reason = S.reason === t.dataset.reason ? '' : t.dataset.reason;
  else if (t.dataset.group) S.group = S.group === t.dataset.group ? '' : t.dataset.group;
  else if (t.dataset.sort) {
    const [view, key] = t.dataset.sort.split(':');
    S.sort = S.sort && S.sort.view === view && S.sort.key === key ? { view, key, dir: -S.sort.dir } : { view, key, dir: key === 'label' || key === 'id' ? 1 : -1 };
  }
  render();
});
document.addEventListener('change', (e) => {
  if (e.target.id === 'price') S.price = e.target.value;
  else if (e.target.id === 'partial') S.partial = e.target.checked;
  else if (e.target.id === 'mode') S.mode = e.target.value;
  else if (e.target.id === 'runpick') { S.run = e.target.value; S.group = ''; S.reason = ''; }
  else if (e.target.id === 'onlyfail') S.onlyFail = e.target.checked;
  else if (e.target.id === 'grp') S.group = e.target.value;
  else return;
  render();
});
let qTimer;
document.addEventListener('input', (e) => {
  if (e.target.id !== 'q') return;
  clearTimeout(qTimer);
  qTimer = setTimeout(() => { S.q = e.target.value; render(); const q = $('#q'); q.focus(); q.setSelectionRange(q.value.length, q.value.length); }, 200);
});
const theme = store.get('theme', '');
if (theme) document.documentElement.dataset.theme = theme;
$('#gen').textContent = 'gerado ' + D.generatedAt.slice(0, 16).replace('T', ' ') + ' · ' + D.runs.length + ' rodadas';
render();
</script>
</body>
</html>`;

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const argv = process.argv.slice(2);
  if (argv.includes('--serve')) {
    // Servidor local: cada recarga refaz o painel, sempre com as rodadas novas.
    const { createServer } = await import('node:http');
    const port = Number(argv[argv.indexOf('--port') + 1]) || Number(process.env.PORT) || 4320;
    createServer(async (req, res) => {
      if (req.url !== '/' && !req.url?.startsWith('/?')) {
        res.writeHead(404).end();
        return;
      }
      try {
        await buildDashboard({ quiet: true });
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
        res.end(readFileSync(OUT));
      } catch (e) {
        res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' }).end(String(e?.stack ?? e));
      }
    }).listen(port, '127.0.0.1', () => console.log(`painel em http://127.0.0.1:${port}/ (refeito a cada recarga)`));
  } else await buildDashboard();
}
