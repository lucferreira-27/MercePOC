import assert from 'node:assert/strict';
import fs from 'node:fs';
const base = process.env.TEST_BASE_URL || 'http://127.0.0.1:4310';
async function post(path, body) {
  const r = await fetch(base + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const d = await r.json();
  if (!r.ok) throw new Error(d.error);
  return d;
}
const previous = process.env.RESUME_SMOKE
  ? JSON.parse(fs.readFileSync('work/live-smoke.json', 'utf8'))
  : null;
let p = previous
  ? await (await fetch(base + '/api/projects?id=' + previous.ids[0])).json()
  : await post('/api/projects', { action: 'create' });
const ids = [p.id];
const results = previous?.results || [];
const cases = [
  ['Aumente a largura para 1 metro', { width: 1000 }],
  ['Deixe branca', { materialId: 'white', width: 1000 }],
  ['Agora 90 centímetros de largura', { width: 900 }],
  ['Aumente a altura em 10 cm', { height: 1900 }],
  ['Profundidade de 0,4 metros', { depth: 400 }],
  ['Coloque três prateleiras internas', { shelfCount: 3 }],
  ['Quero o vão inferior livre com 45 cm', { bottomOpening: 450 }],
  ['Distribua os vãos igualmente', { bottomOpening: null }],
  ['Troque o acabamento para grafite', { materialId: 'graphite' }],
  ['Desfaça a última mudança', { materialId: 'white' }],
  ['Refaça a última mudança', { materialId: 'graphite' }],
  ['Deixe maior', null],
  ['Qual é a largura atual?', null],
  ['Adicione duas portas', null],
  ['Quero duas gavetas', null],
  ['Largura de 5000 mm', null],
  ['Coloque oito prateleiras e altura de 400 mm', null],
  ['Volte a altura para 1,8 m', { height: 1800 }],
  [
    'Mude a profundidade para 35 cm e o material para carvalho',
    { depth: 350, materialId: 'oak' },
  ],
  ['Retire uma prateleira', { shelfCount: 2 }],
];
try {
  for (const [message, expected] of cases.slice(results.length)) {
    const before = JSON.stringify(p.params),
      at = Date.now();
    p = await post('/api/chat', { id: p.id, version: p.version, message });
    if (expected)
      for (const [k, v] of Object.entries(expected))
        assert.equal(p.params[k], v, message);
    else assert.equal(JSON.stringify(p.params), before, message);
    results.push({
      message,
      ms: Date.now() - at,
      params: p.params,
      reply: p.messages.at(-1).content,
    });
    console.log('PASS', results.length, message, Date.now() - at + 'ms');
  }
  const reloaded = await (
    await fetch(base + '/api/projects?id=' + p.id)
  ).json();
  assert.deepEqual(reloaded.params, p.params);
  console.log('PASS persistence read-back');
} finally {
  fs.mkdirSync('work', { recursive: true });
  fs.writeFileSync(
    'work/live-smoke.json',
    JSON.stringify({ ids, results }, null, 2),
  );
}
