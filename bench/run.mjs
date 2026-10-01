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
 *   npm run bench -- --ids uni-01,div-03,foto-01
 *   npm run bench -- --record              # grava as decisões em bench/fixtures
 *   npm run bench -- --offline             # roda sem rede, contra as fixtures
 *   npm run bench -- --out bench/results/depois.json
 *   npm run bench -- --compare bench/results/antes.json
 *   npm run bench -- --agent               # o assistente em laço (lib/agent)
 *   npm run bench -- --agent --record      # grava respostas do modelo e do Jev
 *   npm run bench -- --agent --offline     # repete as gravações, sem rede
 *   npm run bench -- --agent --photo-legacy  # foto pelo caminho antigo (a rota manda foto pelo laço)
 *   npm run bench -- --agent --repeat 3 --concurrency 4   # repetições em paralelo
 *
 * Casos com `image` (foto de referência) usam o arquivo indicado no caso. A
 * foto não é versionada: sem o arquivo o caso é pulado, com o motivo impresso,
 * em vez de virar falha por falta de insumo.
 *
 * No laço, cada repetição tem a própria gravação (`<id>#<n>.json` a partir da
 * segunda). Erro do provedor não conta como falha: o caso roda de novo (até
 * duas vezes) e, se continuar, a linha sai com `infra: true`, fora da taxa.
 */
import { AsyncLocalStorage } from 'node:async_hooks';
import { createHash, randomUUID } from 'node:crypto';
import { execSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';

// O banco do benchmark é temporário: a base real nunca é tocada.
process.env.MERCE_DATA_DIR = mkdtempSync(join(tmpdir(), 'merce-bench-'));

const { applyRequest, create, get, revise, save, undo } = await import('../lib/store.ts');
const { saveImage, imageDataUrl } = await import('../lib/images.ts');
const { planDataUrl } = await import('../lib/plan-render.ts');
const { interpretStream, profile, reviewAndCorrect } = await import('../lib/gateway.ts');
const { addUsage, emptyUsage, priceOf, modelInfo, reasoningEffort, MODEL_KEYS, DEFAULT_MODEL } = await import('../lib/models.ts');
const { executeRequest, generateDesign, entityIds, canonical, normalize } = await import('../lib/studio.ts');
const { drawingParts } = await import('../lib/fittings.ts');
const { runAgentTurn } = await import('../lib/agent/turn.ts');
const { AGENT_SYSTEM } = await import('../lib/agent/prompt.ts');
const { toolSpecs } = await import('../lib/agent/loop.ts');
const { DEFAULT_PRICES } = await import('../lib/quote.ts');
const { callModel } = await import('../lib/agent/model.ts');
const { fitReport, applyObstacleEdits } = await import('../lib/room.ts');
const { cases, groups, askActMiss, INFRA_ERROR, caseHash } = await import('./cases.mjs');

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
const model = value('model', fast ? 'qwen-fast' : DEFAULT_MODEL);
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
const agent = flag('agent');
// --concurrency N: casos em paralelo (cada um com seu estado; ver caseState).
const concurrency = Math.max(1, Number(value('concurrency', '1')));
// Espera antes de rodar de novo um caso que caiu por erro do provedor.
const INFRA_WAITS = [10_000, 30_000];
// Com --agent, foto vai pelo laço, como na rota. --photo-legacy mede o caminho
// antigo (uma chamada e a conferência); --photo-loop fica aceito, é o padrão.
const photoLoop = !flag('photo-legacy');
// O laço grava outra coisa (a sequência de respostas do modelo e do Jev):
// pasta própria, para não misturar com as decisões do caminho antigo.
// --fixtures <pasta>: gravações do laço noutra pasta (a base fica separada do candidato).
const fixtureDir = resolve(value('fixtures', agent ? 'bench/fixtures/agent' : 'bench/fixtures'));
// Offline o Jev responde da gravação; sem chave, askJev nem chamaria o fetch.
if (agent && offline) process.env.TYPESAFE_API_KEY ||= 'offline';

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


/** Impressão curta de um estado (design canônico + ambiente), para ligar a evidência ao estado. */
const stateHash = (design, room) =>
  createHash('sha256').update(JSON.stringify({ design: canonical(design), room: room ?? null })).digest('hex').slice(0, 12);
/** Revisão do código e mudanças locais, para a rodada ser interpretável depois. */
const codeRevision = (() => {
  try {
    const head = execSync('git rev-parse --short HEAD', { encoding: 'utf8' }).trim();
    const dirty = execSync('git status --porcelain', { encoding: 'utf8' }).split(/\r?\n/).filter(Boolean).length;
    return { head, dirtyFiles: dirty };
  } catch {
    return null;
  }
})();

// --ids a,b,c: exatamente estes casos (ex.: só os que costumam errar).
const onlyIds = value('ids') ? new Set(value('ids').split(',').map((v) => v.trim())) : null;
const selected = cases.filter(
  (c) =>
    (!onlyGroup || c.group === onlyGroup) &&
    (!onlyId || c.id.includes(onlyId)) &&
    (!onlyIds || onlyIds.has(c.id)) &&
    (agent || !c.agentOnly),
);
if (!selected.length) {
  console.error('Nenhum caso selecionado.');
  process.exit(1);
}

const startedAll = Date.now();
let providerCalls = 0;
let providerMs = 0;
const realFetch = globalThis.fetch;
/**
 * Estado de cada caso: a fita do Jev (gravada com --record, repetida com
 * --offline) e as chamadas ao provedor. Com --concurrency os casos correm
 * juntos, e o fetch acha o caso certo pelo contexto assíncrono.
 */
const caseState = new AsyncLocalStorage();
const isJev = (url) => String(url).includes('typesafe.ai');
globalThis.fetch = async (...callArgs) => {
  const st = caseState.getStore();
  if (agent && isJev(callArgs[0]) && st?.jevTape) {
    // Cada chamada do Jev é identificada pelas perguntas (roteador, pedido,
    // resposta): chamadas em paralelo não trocam de lugar na repetição.
    const asked = Object.keys(JSON.parse(callArgs[1]?.body ?? '{}').questions ?? {}).sort().join(',');
    if (offline) {
      const i = st.jevTape.findIndex((t) => t.asked === asked);
      const body = i >= 0 ? st.jevTape.splice(i, 1)[0].body : undefined;
      return body == null
        ? new Response('sem gravação', { status: 503 })
        : new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    const response = await realFetch(...callArgs);
    const body = await response.clone().json().catch(() => null);
    st.jevTape.push({ asked, body });
    return response;
  }
  providerCalls++;
  if (st) st.calls++;
  const t0 = Date.now();
  try {
    return await realFetch(...callArgs);
  } finally {
    providerMs += Date.now() - t0;
  }
};

/** Mesmo laço de reparo da rota: erro de validação volta para o modelo. */
async function interpretWithRepair(before, revision, messages, selection, context, telemetry, currentView) {
  const st = caseState.getStore();
  const callOnce = async (note) => {
    const t0 = Date.now();
    const callsBefore = st.calls;
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
    telemetry.calls += st.calls - callsBefore;
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

/**
 * Um caso pelo assistente em laço, como a rota faz: grava a mensagem, roda
 * `runAgentTurn` e traduz o resultado para as ações do caminho antigo
 * (update, clarify, answer, undo, redo), para as mesmas expectativas valerem.
 */
async function runAgentCase(project, benchCase, image, selection, telemetry, fixtureFile) {
  const revision = project.revisions[project.cursor];
  const before = revision.params;
  const roomBefore = project.room ?? null;
  const user = {
    id: 'bench-user',
    role: 'user',
    content: benchCase.prompt,
    revisionId: revision.id,
    revision: revision.number,
    ...(image ? { image } : {}),
    context: { requestId: `bench-${benchCase.id}`, baseRevisionId: revision.id, selectedPartIds: selection, referencedPartIds: selection },
  };
  project.messages.push(user);
  const version = save(project, project.version).version;
  const st = caseState.getStore();
  let replies = [];
  let tape = { replies: [], jev: [] };
  if (offline) {
    if (!existsSync(fixtureFile)) throw new Error(`sem fixture gravada: ${basename(fixtureFile)} (rode com --agent --record)`);
    tape = JSON.parse(readFileSync(fixtureFile, 'utf8'));
    replies = [...tape.replies];
    st.jevTape = [...tape.jev];
  } else st.jevTape = [];
  const t0 = Date.now();
  // Chamada identificada pelo pedido da conversa e pela posição nela: as
  // opções rodam sub-laços em paralelo, e a ordem de chegada varia.
  const keyOf = (messages) => {
    const first = messages[1]?.content;
    const text = typeof first === 'string' ? first : (first?.find?.((p) => p.type === 'text')?.text ?? '');
    return `${messages.length}|${text.slice(text.lastIndexOf('Pedido: '))}`;
  };
  const call = offline
    ? async (o) => {
        const key = keyOf(o.messages);
        const i = replies.findIndex((r) => r.key === key);
        const next = i >= 0 ? replies.splice(i, 1)[0] : replies.shift();
        if (!next) throw new Error('a gravação acabou antes do laço (o caminho mudou)');
        return next.reply ?? next;
      }
    : async (o) => {
        const key = keyOf(o.messages);
        const reply = await callModel(o);
        tape.replies.push({ key, reply });
        return reply;
      };
  const r = await runAgentTurn({
    project,
    version,
    user,
    request: benchCase.prompt,
    selected: selection,
    ui: null,
    prices: structuredClone(DEFAULT_PRICES),
    ...(image ? { image } : {}),
    model,
    requestId: `bench-${benchCase.id}`,
    started: t0,
    signal: new AbortController().signal,
    progress: () => {},
    emit: () => {},
    onUsage: (usage, used = model) => (telemetry.usage = addUsage(telemetry.usage, usage, priceOf(used, process.env))),
    usage: () => ({ usage: telemetry.usage }),
    call,
  });
  telemetry.latencyMs += Date.now() - t0;
  telemetry.calls += offline ? tape.replies.length - replies.length : tape.replies.length;
  if (!offline) tape.jev = st.jevTape;
  st.jevTape = null;
  if (record && !offline) {
    mkdirSync(dirname(fixtureFile), { recursive: true });
    writeFileSync(fixtureFile, JSON.stringify({ id: benchCase.id, at: new Date().toISOString(), model, ...tape }, null, 1));
  }
  const final = get(r.projectId);
  const answer = final.messages.at(-1);
  const steps = answer.report?.steps ?? [];
  const did = (tool) => steps.some((s) => s.ok && s.tool === tool);
  const outcome = answer.result?.outcome;
  const action =
    outcome === 'clarification'
      ? 'clarify'
      : did('history_undo')
        ? 'undo'
        : did('history_redo')
          ? 'redo'
          : outcome === 'applied'
            ? 'update'
            : 'answer';
  const designAfter = final.revisions[final.cursor].params;
  const options = answer.clarification?.options ?? [];
  const alive = new Set(entityIds(designAfter));
  const room = final.room;
  // Um Ctrl+Z depois do turno (sem gravar): tem de voltar ao começo.
  let undone = null;
  if (final.revisions[final.cursor].id !== revision.id) {
    const copy = get(r.projectId);
    undo(copy);
    undone = { design: copy.revisions[copy.cursor].params, room: copy.room ?? null };
  }
  return {
    before,
    roomBefore,
    undo: undone,
    parts: generateDesign(designAfter).parts,
    cells: generateDesign(designAfter).cells,
    startHash: stateHash(before, roomBefore),
    finalHash: stateHash(designAfter, room),
    report: { outcome: answer.result?.outcome ?? null, applied: answer.result?.appliedOperations?.length ?? 0, attempted: answer.result?.attemptedOperations?.length ?? null, facts: answer.report?.facts ?? null, verification: answer.report?.verification ?? null, review: answer.report?.review ?? null },
    design: designAfter,
    effects: r.state.effects ?? [],
    fronts: r.state.viewAction ?? null,
    room,
    fitIssues: room ? fitReport(designAfter, room).issues.length : 0,
    project: { name: final.name, cursor: final.cursor, versions: final.revisions.length },
    cards: answer.options ?? [],
    action,
    content: String(answer.content ?? ''),
    applied: final.revisions[final.cursor].id !== revision.id,
    designAfter,
    options,
    deadOptions: options.filter((o) => !(o.partIds ?? []).some((pid) => alive.has(pid))).length,
    suggestions: answer.suggestions ?? [],
    steps: steps.map((s) => ({ tool: s.tool, label: s.label, ok: s.ok, ...(s.detail ? { detail: s.detail } : {}) })),
  };
}

function evaluate(benchCase, info, helpers) {
  const errors = [];
  const expect = benchCase.expect ?? {};
  const allowed = expect.action
    ? Array.isArray(expect.action)
      ? expect.action
      : [expect.action]
    : null;
  // Perguntar ou agir vem primeiro e com nome próprio: é o erro que o painel
  // separa ("perguntou em vez de fazer", "fez em vez de perguntar").
  const miss = askActMiss(benchCase.askAct, info.action);
  if (miss) errors.push(miss);
  else if (allowed && !allowed.includes(info.action)) {
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
  // Nota contra o gabarito (fotos reais): abaixo do mínimo, o motivo vai no erro.
  if (expect.score && info.action === 'update' && info.score) {
    const s = info.score;
    if (s.total < (expect.minScore ?? 0.7))
      errors.push(`parecido ${Math.round(s.total * 100)}% (mínimo ${Math.round((expect.minScore ?? 0.7) * 100)}%): ${Object.entries(s.parts).map(([k, v]) => `${k} ${v}`).join(', ')}; ${s.notes.join('; ')}`);
  }
  if (expect.agent && info.agent) {
    const verdict = expect.agent(info.agent);
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

/** Gravação do caso: no laço, cada repetição tem a sua a partir da segunda. */
const fixtureOf = (benchCase, run) => {
  // Foto roda pelo caminho antigo também com --agent: usa as fixtures dele.
  const loop = agent && (!benchCase.image || photoLoop);
  return join(loop ? fixtureDir : resolve('bench/fixtures'), `${benchCase.id}${loop && run > 1 ? `#${run}` : ''}.json`);
};

/** Um caso, uma vez: prepara o projeto, roda o turno e avalia. */
async function runCase(benchCase, run, imagePath) {
  const telemetry = { latencyMs: 0, calls: 0, retries: 0, networkRetries: 0, usage: emptyUsage(model) };
  const row = {
    id: benchCase.id,
    group: benchCase.group,
    run,
    askAct: benchCase.askAct ?? null,
    caseHash: caseHash(benchCase),
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
    // Cena gravada (cópia isolada de um projeto real ou variação): vira a
    // versão de partida, com o ambiente dela.
    if (benchCase.setup?.scene) {
      const scene = JSON.parse(readFileSync(resolve(benchCase.setup.scene), 'utf8'));
      project.room = scene.room;
      revise(project, normalize(scene.design), `preparação ${benchCase.id}`);
      save(project, project.version);
    }
    if (benchCase.setup?.room) {
      project.room = benchCase.setup.room;
      save(project, project.version);
    }
    if (benchCase.setup?.ops?.length) {
      const applied = applyRequest(project, benchCase.setup.ops, `preparação ${benchCase.id}`);
      if (!applied.ok) throw new Error(`preparação falhou: ${applied.error}`);
      save(project, project.version);
    }
    // Conversa antes do pedido: foto num pedido anterior e a conferência
    // dela, como a rota grava. O pedido do caso entra depois dela.
    for (const h of benchCase.setup?.history ?? []) {
      const revisionId = project.revisions[project.cursor].id;
      project.messages.push({
        id: randomUUID(),
        role: h.role,
        content: h.content,
        ...(h.image ? { image: await saveImage(readFileSync(resolve(h.image)), basename(h.image)) } : {}),
        ...(h.review
          ? {
              result: { outcome: 'applied', resultRevisionId: revisionId, appliedOperations: [], changes: [] },
              report: { durationMs: 0, outcome: 'applied', changes: [], review: h.review },
            }
          : {}),
      });
    }
    if (benchCase.setup?.history?.length) save(project, project.version);
    const fresh = get(project.id);
    const revision = fresh.revisions[fresh.cursor];
    const before = revision.params;
    const selected = benchCase.setup?.selected;
    const selection = typeof selected === 'function' ? selected(before) : (selected ?? []);
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

    const fixtureFile = fixtureOf(benchCase, run);
    // Foto vai pelo caminho antigo, como na rota (ver app/api/chat/route.ts).
    if (agent && (!image || photoLoop)) {
      const got = await runAgentCase(project, benchCase, image, selection, telemetry, fixtureFile);
      const generated = generateDesign(got.designAfter);
      row.warnings = generated.warnings ?? [];
      row.action = got.action;
      row.applied = got.applied;
      row.steps = got.steps;
      row.decision = { action: got.action, message: got.content, ops: [], refs: [], suggestions: got.suggestions };
      // Tentativas recusadas (validação, argumento, nada coube) e a evidência do estado.
      row.rejected = got.steps.filter((s) => !s.ok && s.tool !== 'finish' && s.tool !== 'ask_user').length;
      row.repairs = got.steps.filter((s) => !s.ok && s.tool === 'finish').length;
      row.startHash = got.startHash;
      row.finalHash = got.finalHash;
      row.report = got.report;
      // O estado gravado, para julgar de novo com outro oráculo sem repetir o turno.
      if (benchCase.group === 'composicao') row.final = { design: canonical(got.designAfter), room: got.room ?? null };
      const score = benchCase.expect?.score && got.action === 'update' ? benchCase.expect.score(got.designAfter, got.room ?? null) : null;
      if (score) row.score = score;
      if (benchCase.truth) row.final = { design: canonical(got.designAfter), room: got.room ?? null };
      row.errors.push(
        ...evaluate(
          benchCase,
          { ...got, agent: got, ...(score ? { score } : {}) },
          { design: got.designAfter, before, parts: generated.parts, cells: generated.cells, content: got.content },
        ),
      );
      if (got.oracle) row.oracle = { ok: got.oracle.ok, failures: got.oracle.failures, facts: got.oracle.facts };
      row.ok = row.errors.length === 0;
      throw null;
    }
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
        image ? await planDataUrl(drawingParts(canonical(before))) : undefined,
      );
      decision = interpreted.decision;
      row.preview = interpreted.preview;
      // Com --agent a gravação do caminho antigo (foto) fica como está: é a
      // fixture de outra rodada, e sobrescrevê-la estraga o --offline dela.
      if (record && !agent) {
        mkdirSync(dirname(fixtureFile), { recursive: true });
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
        // Como a rota: obstáculos da decisão entram no ambiente, e o turno de
        // foto passa pela conferência do desenho (com a correção dela).
        const obs = decision.obstacles;
        if (obs && (obs.add?.length || obs.move?.length || obs.remove?.length))
          project.room = applyObstacleEdits(project.room, obs, before.width ?? 0).room;
        let finalDesign = preview.design;
        if (applied && image && !offline) {
          const t0 = Date.now();
          const checked = await reviewAndCorrect(
            {
              photo: await imageDataUrl(image.id),
              result: await planDataUrl(drawingParts(canonical(finalDesign))),
              design: finalDesign,
              applied: ops,
              request: benchCase.prompt,
              model,
              room: project.room,
              onUsage: (usage) => (telemetry.usage = addUsage(telemetry.usage, usage, priceOf(model, process.env))),
            },
            executeRequest,
          );
          telemetry.latencyMs += Date.now() - t0;
          telemetry.calls += checked?.review.rejected ? 2 : 1;
          if (checked) {
            row.review = checked.review;
            if (checked.ops.length) finalDesign = checked.design;
          }
        }
        if (applied) {
          revise(project, finalDesign, benchCase.prompt.slice(0, 60));
          save(project, project.version);
          designAfter = finalDesign;
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
    const roomAfter = project.room ?? null;
    const helpers = {
      design: designAfter,
      before,
      room: roomAfter,
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
      ...(benchCase.expect?.score && action === 'update' ? { score: benchCase.expect.score(designAfter, roomAfter) } : {}),
    };
    if (info.score) row.score = info.score;
    if (benchCase.truth) row.final = { design: canonical(designAfter), room: roomAfter };
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
    // `throw null` sai do caso do laço, já avaliado.
    if (e !== null) row.errors.push(`exceção: ${e instanceof Error ? e.message : String(e)}`);
  }
  row.calls = telemetry.calls;
  row.retries = telemetry.retries;
  row.networkRetries = telemetry.networkRetries;
  row.latencyMs = Math.round(telemetry.latencyMs);
  row.costUsd = telemetry.usage.costUsd;
  row.tokens = { input: telemetry.usage.inputTokens, cached: telemetry.usage.cachedTokens, output: telemetry.usage.outputTokens };
  row.infra = row.errors.some((e) => INFRA_ERROR.test(e));
  return row;
}

/** Erro do provedor não é resultado do assistente: roda o caso de novo, com espera. */
async function runWithRetry(benchCase, run, imagePath) {
  for (let attempt = 0; ; attempt++) {
    const row = await caseState.run({ jevTape: null, calls: 0 }, () => runCase(benchCase, run, imagePath));
    row.attempts = attempt + 1;
    if (!row.infra || offline || !agent || attempt >= INFRA_WAITS.length) return row;
    console.log(`   (${row.id}#${run}: erro do provedor; o caso roda de novo em ${INFRA_WAITS[attempt] / 1000}s)`);
    await new Promise((done) => setTimeout(done, INFRA_WAITS[attempt]));
  }
}

const jobs = [];
for (const benchCase of selected) {
  if (onlyMissing && existsSync(fixtureOf(benchCase, 1))) {
    console.log(`pulado ${benchCase.id} (fixture já gravada)`);
    continue;
  }
  const imagePath = benchCase.image ? resolve(benchCase.image) : '';
  const missing = [benchCase.image, ...(benchCase.setup?.history ?? []).map((h) => h.image)].find((f) => f && !existsSync(resolve(f)));
  if (missing) {
    console.log(`pulado ${benchCase.id} (sem a foto ${missing}; coloque o arquivo para rodar)`);
    skipped.push({ id: benchCase.id, reason: `foto ausente: ${missing}` });
    continue;
  }
  for (let run = 1; run <= repeat; run++) jobs.push({ benchCase, run, imagePath });
}

async function worker() {
  while (!stopped && jobs.length) {
    const { benchCase, run, imagePath } = jobs.shift();
    if (pauseMs) await new Promise((done) => setTimeout(done, pauseMs));
    const row = await runWithRetry(benchCase, run, imagePath);
    results.push(row);
    const mark = row.infra ? 'INFRA' : row.ok ? 'ok  ' : 'FALHA';
    const sugestoes = row.decision?.suggestions?.length
      ? ` · ${row.decision.suggestions.length} sugestão(ões)`
      : '';
    console.log(
      `${mark} ${row.id}${repeat > 1 ? `#${run}` : ''} · ${row.action.padEnd(7)} · ${String(row.latencyMs).padStart(6)} ms · ${row.calls} chamada(s)${sugestoes}${row.retries ? ` · ${row.retries} correção(ões)` : ''}${row.rejected ? ` · ${row.rejected} recusa(s)` : ''}${row.ok ? '' : ` · ${row.errors.join(' | ')}`}`,
    );
    if (budgetSeconds && (Date.now() - startedAll) / 1000 > budgetSeconds && !stopped) {
      console.log(`\n(orçamento de ${budgetSeconds}s atingido: parando)`);
      stopped = true;
    }
    if (maxCalls && providerCalls > maxCalls && !stopped) {
      console.log(`\n(teto de ${maxCalls} chamadas ao provedor atingido: parando)`);
      stopped = true;
    }
  }
}
await Promise.all(Array.from({ length: Math.min(concurrency, jobs.length) }, worker));
// Em paralelo os casos terminam fora de ordem: volta para a ordem do corpus.
const orderOf = new Map(selected.map((c, i) => [c.id, i]));
results.sort((a, b) => orderOf.get(a.id) - orderOf.get(b.id) || a.run - b.run);

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

// Linhas de infraestrutura (provedor fora mesmo depois de rodar de novo)
// ficam fora da taxa: não dizem nada sobre o assistente.
const valid = results.filter((r) => !r.infra);
const byGroup = {};
for (const row of valid) {
  const g = (byGroup[row.group] ??= { total: 0, ok: 0, latencies: [], calls: [], retries: 0 });
  g.total++;
  if (row.ok) g.ok++;
  g.latencies.push(row.latencyMs);
  g.calls.push(row.calls);
  g.retries += row.retries;
}
const providerHost = (() => {
  try {
    return new URL(profile(model).baseUrl).host;
  } catch {
    return null;
  }
})();
const effort = reasoningEffort(modelInfo(model)) ?? null;
// Portão do perguntar (lib/agent/ask-gate.ts): MERCE_ASK_GATE=0 desliga.
const askGate = agent ? process.env.MERCE_ASK_GATE !== '0' : null;
/** Rótulo da rodada quando --label falta: modelo, provedor, esforço e modo. */
const autoLabel = () => {
  const host = String(providerHost ?? '');
  const via = /commandcode/.test(host) ? 'Command Code' : /opencode/.test(host) ? 'Zen' : /nano-gpt/.test(host) ? 'NanoGPT' : host || '?';
  return [
    model,
    via,
    effort ?? 'padrão',
    agent ? 'laço' : 'legado',
    askGate === false && 'sem portão',
    offline && 'offline',
    !photoLoop && 'foto no caminho antigo',
    repeat > 1 && `×${repeat}`,
    onlyGroup && onlyGroup,
    onlyIds && `${onlyIds.size} casos`,
  ]
    .filter(Boolean)
    .join(' · ');
};
/** Acerto por repetição: com --repeat, a taxa vira média e faixa (mín–máx). */
const byRun = [];
for (let run = 1; run <= repeat; run++) {
  const rows = valid.filter((r) => r.run === run);
  if (rows.length) byRun.push({ run, cases: rows.length, passed: rows.filter((r) => r.ok).length, passRate: rows.filter((r) => r.ok).length / rows.length });
}
const summary = {
  at: new Date().toISOString(),
  offline,
  agent,
  // Como a rodada foi feita, para o painel (npm run bench:dash) comparar.
  label: value('label') || autoLabel(),
  provider: providerHost,
  providerModel: (() => {
    try {
      return profile(model).model;
    } catch {
      return null;
    }
  })(),
  effort,
  askGate,
  photoLoop,
  repeat,
  concurrency,
  price: priceOf(model, process.env),
  argv: args.join(' '),
  code: codeRevision,
  // Versão do que o modelo vê: regras fixas e ferramentas.
  promptHash: createHash('sha256').update(AGENT_SYSTEM + JSON.stringify(toolSpecs())).digest('hex').slice(0, 12),
  fixtures: agent ? fixtureDir : null,
  rejected: results.reduce((a, r) => a + (r.rejected ?? 0), 0),
  fast,
  model,
  cases: results.length,
  valid: valid.length,
  infra: results.length - valid.length,
  skipped,
  passed: valid.filter((r) => r.ok).length,
  passRate: valid.length ? valid.filter((r) => r.ok).length / valid.length : 0,
  ...(repeat > 1
    ? {
        repeats: {
          byRun,
          mean: byRun.reduce((a, r) => a + r.passRate, 0) / Math.max(1, byRun.length),
          min: Math.min(...byRun.map((r) => r.passRate)),
          max: Math.max(...byRun.map((r) => r.passRate)),
          // Casos que passaram em umas repetições e falharam em outras.
          unstable: [...new Set(valid.map((r) => r.id))].filter((id) => new Set(valid.filter((r) => r.id === id).map((r) => r.ok)).size > 1),
        },
      }
    : {}),
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
  failures: valid
    .filter((r) => !r.ok)
    .map((r) => ({ id: r.id, run: r.run, action: r.action, errors: r.errors, ops: r.decision?.ops, message: r.decision?.message })),
  results,
};

console.log(`\n=== resumo (${model}${agent ? ', assistente em laço' : ''}) ===`);
console.log(
  `${summary.passed}/${summary.valid} casos válidos (${(summary.passRate * 100).toFixed(0)}%)${summary.infra ? ` · ${summary.infra} infra (provedor)` : ''} · latência média ${summary.latencyMs.mean} ms, mediana ${summary.latencyMs.median} ms, p90 ${summary.latencyMs.p90} ms, máx ${summary.latencyMs.max} ms · ${summary.providerCalls.mean} chamada(s) por caso · ${summary.retries} correção(ões) · custo US$ ${summary.costUsd.toFixed(4)} (US$ ${(summary.costUsd / Math.max(1, summary.cases)).toFixed(5)} por caso)`,
);
for (const [name, g] of Object.entries(summary.groups))
  console.log(`  ${name.padEnd(14)} ${g.ok}/${g.total}  latência mediana ${g.latency.median} ms${g.retries ? `  correções ${g.retries}` : ''}`);
if (skipped.length)
  console.log(`  pulados: ${skipped.map((s) => `${s.id} (${s.reason})`).join(', ')}`);
if (summary.repeats) {
  const p = (v) => `${Math.round(v * 100)}%`;
  console.log(
    `  repetições: acerto médio ${p(summary.repeats.mean)} (${p(summary.repeats.min)} a ${p(summary.repeats.max)}) · instáveis: ${summary.repeats.unstable.join(', ') || 'nenhum'}`,
  );
}
if (summary.infra)
  console.log(`  infra: ${results.filter((r) => r.infra).map((r) => `${r.id}#${r.run}`).join(', ')} (provedor fora; fora da taxa)`);
if (summary.failures.length) {
  console.log('\n=== falhas (o que aprender com elas) ===');
  for (const f of summary.failures) console.log(`- ${f.id}${repeat > 1 ? `#${f.run}` : ''}: ${f.errors.join(' | ')}`);
}

if (outFile) {
  mkdirSync(dirname(outFile), { recursive: true });
  writeFileSync(outFile, JSON.stringify(summary, null, 1));
  console.log(`\nresultado escrito em ${outFile}`);
  // O painel (bench/results/painel.html) acompanha cada rodada gravada.
  try {
    const { buildDashboard } = await import('./dashboard.mjs');
    await buildDashboard();
  } catch (e) {
    console.log(`(painel não atualizado: ${e instanceof Error ? e.message : e})`);
  }
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
    for (const row of valid) {
      const old = before.get(`${row.id}#${row.run}`);
      if (!old || old.infra) continue;
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

process.exitCode = summary.failures.length || summary.infra ? 1 : 0;
