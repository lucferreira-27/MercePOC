import assert from 'node:assert/strict';
import fs from 'node:fs';
const base = process.env.TEST_BASE_URL || 'http://127.0.0.1:4310';
fs.mkdirSync('work', { recursive: true });
const previous =
  process.env.RESUME_MODULAR && fs.existsSync('work/modular-live.json')
    ? JSON.parse(fs.readFileSync('work/modular-live.json', 'utf8'))
    : null;
const log = previous?.log ?? [];
async function post(path, body, attempt = 0) {
  const r = await fetch(base + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const result = await r.json();
  if (!r.ok) {
    if (/429|503/.test(String(result.error)) && attempt < 3) {
      console.log('Gateway rate limit, retrying in 30s');
      await new Promise((resolve) => setTimeout(resolve, 30000));
      return post(path, body, attempt + 1);
    }
    throw new Error(result.error);
  }
  return result;
}
let p = previous
  ? await (await fetch(base + '/api/projects?id=' + previous.id)).json()
  : await post('/api/projects', { action: 'create' });
if (!previous)
  p = await post('/api/projects', {
    id: p.id,
    version: p.version,
    action: 'rename',
    name: 'Aceite modular · GLM',
  });
async function chat(message, check) {
  const requestId = crypto.randomUUID(),
    before = p,
    at = Date.now();
  p = await post('/api/chat', {
    id: p.id,
    version: p.version,
    message,
    requestId,
  });
  log.push({
    message,
    ms: Date.now() - at,
    reply: p.messages.at(-1)?.content,
    outcome: p.messages.at(-1)?.result?.outcome,
    ops: p.messages.at(-1)?.result?.appliedOperations,
    revision: p.cursor + 1,
  });
  fs.writeFileSync(
    'work/modular-live.json',
    JSON.stringify({ id: p.id, log, project: p }, null, 2),
  );
  console.log(JSON.stringify(log.at(-1)));
  check(p, before);
  return { requestId, before };
}
if (log.length < 1)
  await chat(
    'Retire todas as quatro prateleiras internas. Mude o módulo existente para 800 mm de largura, 900 mm de altura e 450 mm de profundidade. Chame esse módulo de Base esquerda. Mantenha carvalho e o fundo.',
    (p) => {
      assert.equal(p.parts.filter((x) => x.kind === 'shelf').length, 0);
      assert.equal(p.params.modules[0].height, 900);
    },
  );
if (log.length < 2)
  await chat(
    'Adicione um nicho chamado Base direita de 800 mm de largura, 900 mm de altura e 450 mm de profundidade, carvalho com fundo. Conecte à direita da Base esquerda compartilhando a lateral completa, sem afastamento.',
    (p) => {
      assert.equal(p.params.modules.length, 2);
      assert.equal(p.parts.filter((x) => x.owners?.length === 2).length, 1);
    },
  );
if (log.length < 3)
  await chat(
    'Na Base esquerda, crie uma prateleira deixando 400 mm livres abaixo. Coloque três gavetas no compartimento de baixo e duas portas de abrir no compartimento de cima.',
    (p) => {
      assert.equal(p.parts.filter((x) => x.kind === 'door').length, 2);
      assert.equal(p.parts.filter((x) => x.kind === 'drawer').length, 18);
    },
  );
const successful =
  log.length < 4
    ? await chat(
        'Adicione um terceiro nicho chamado Retorno de 600 mm de largura, 900 mm de altura e 450 mm de profundidade. Gire em 90 graus e conecte à direita da Base direita sem compartilhar, alinhando pelos fundos, afastamento de 50 mm, para formar um L.',
        (p) => {
          assert.equal(p.params.modules.length, 3);
          assert.equal(p.params.modules[2].rotation, 90);
          assert.equal(p.parts.filter((x) => x.owners?.length === 2).length, 1);
        },
      )
    : null;
if (successful) {
  const replay = await post('/api/chat', {
    id: p.id,
    version: successful.before.version,
    message: log.at(-1).message,
    requestId: successful.requestId,
  });
  assert.equal(replay.version, p.version);
  assert.equal(replay.revisions.length, p.revisions.length);
}
if (log.length < 5)
  await chat(
    'Abra as portas e gavetas da Base esquerda para eu inspecionar.',
    (next, prev) => {
      assert.equal(next.revisions.length, prev.revisions.length);
      assert.ok(next.viewAction?.open);
    },
  );
const whole = structuredClone(p.params);
if (log.length < 6)
  await chat('Desfaça a última alteração do projeto.', (p) =>
    assert.equal(p.params.modules.length, 2),
  );
p = await post('/api/projects', {
  id: p.id,
  version: p.version,
  action: 'redo',
});
assert.deepEqual(p.params, whole);
const fork = await post('/api/projects', {
  id: p.id,
  version: p.version,
  action: 'fork',
  cursor: p.cursor,
  name: 'Aceite modular · alternativa',
});
assert.deepEqual(fork.params, whole);
fs.writeFileSync(
  'work/modular-live.json',
  JSON.stringify({ id: p.id, forkId: fork.id, log, project: p }, null, 2),
);
console.log(
  'PASS live modular acceptance, deduplication, undo, redo and alternative',
  p.id,
);
