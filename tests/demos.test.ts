import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { DEMOS, buildDemo } from '../lib/demos';
import { backupDatabase, create, get, list, putProject, removeDemosExcept, removeNonDemo, view } from '../lib/store';
import { cortecloud, cutCSV, executeRequest, generateDesign } from '../lib/studio';
import { fitReport } from '../lib/room';
import { quote, DEFAULT_PRICES } from '../lib/quote';
import type { ModularPart } from '../lib/composition';

process.env.MERCE_DATA_DIR = mkdtempSync(join(tmpdir(), 'merce-demos-'));

const built = DEMOS.map((r, i) => buildDemo(r, i));

void test('demos: nomes marcados, ids fixos e únicos, na ordem da vitrine', () => {
  assert.ok(DEMOS.length >= 4 && DEMOS.length <= 6);
  assert.equal(new Set(DEMOS.map((d) => d.id)).size, DEMOS.length);
  assert.equal(new Set(DEMOS.map((d) => d.template)).size, DEMOS.length, 'cada demo parte de um modelo diferente');
  for (const [i, { project: p }] of built.entries()) {
    assert.match(p.name, /^Demo · /);
    assert.match(p.id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    assert.deepEqual(p.demo, { key: DEMOS[i].key, order: i });
  }
  // A vitrine aparece na ordem das receitas: a mais recente é a primeira.
  const updated = built.map((b) => b.updated);
  assert.deepEqual([...updated].sort().reverse(), updated);
});

void test('demos: última versão aberta, cabendo no ambiente, com orçamento, corte e exportações', () => {
  for (const { project: p } of built) {
    assert.equal(p.cursor, p.revisions.length - 1, p.name);
    assert.ok(p.revisions.length >= 5, `${p.name}: histórico curto`);
    const final = p.revisions[p.cursor];
    assert.ok(p.room && final.room, `${p.name}: sem ambiente`);
    const fit = fitReport(final.params, p.room);
    assert.ok(fit.fits, `${p.name}: ${fit.issues.map((i) => i.message).join('; ')}`);
    const g = generateDesign(final.params);
    assert.ok(final.params.modules.length <= 12 && g.parts.length <= 200);
    const q = quote(g.parts as ModularPart[], final.params.modules.length, DEFAULT_PRICES);
    assert.ok(q.total > 0 && q.plan.sheets.length > 0, `${p.name}: orçamento vazio`);
    assert.ok(cutCSV(final.params).split('\n').length > 5);
    assert.ok(cortecloud(final.params));
    assert.doesNotThrow(() => view(p));
  }
});

void test('demos: cada mensagem aponta para uma versão real e a Edição reproduz a versão', () => {
  for (const { project: p } of built) {
    const ids = new Map(p.revisions.map((r, i) => [r.id, i]));
    for (const m of p.messages) {
      assert.ok(m.revisionId && ids.has(m.revisionId), `${p.name}: mensagem sem versão`);
      if (m.context) assert.ok(ids.has(m.context.baseRevisionId));
      if (m.result?.outcome !== 'applied') continue;
      // As operações gravadas, aplicadas na versão de base, dão a versão de resultado.
      const base = p.revisions[ids.get(m.context!.baseRevisionId)!];
      const result = p.revisions[ids.get(m.result.resultRevisionId)!];
      const replay = executeRequest(base.params, m.result.appliedOperations);
      assert.ok(replay.ok);
      // front.set sorteia o id da frente: compara sem ele.
      const bare = (v: unknown) => JSON.stringify(v).replace(/"front-[^"]+"/g, '"front"');
      assert.equal(bare(replay.design.modules), bare(result.params.modules), `${p.name}: ${m.content.slice(0, 40)}`);
      assert.ok(m.report?.highlights?.length, `${p.name}: resposta sem Edição`);
      // Rótulo da versão = o pedido inteiro (até 90 caracteres, como o assistente grava).
      assert.equal(result.label, p.messages[p.messages.indexOf(m) - 1].content);
    }
    // Versões sem pedido são mudanças no ambiente, como as do painel.
    const asked = new Set(p.messages.map((m) => m.result?.resultRevisionId));
    for (const r of p.revisions.slice(1))
      if (!asked.has(r.id)) assert.notDeepEqual(r.room, p.revisions[p.revisions.indexOf(r) - 1].room, `${p.name}: ${r.label}`);
  }
});

void test('gravar as demos duas vezes não duplica e --replace só apaga o que não é demo', () => {
  create();
  const put = () => {
    for (const { project, updated } of DEMOS.map((r, i) => buildDemo(r, i))) putProject(project, updated);
  };
  put();
  put();
  assert.equal(list().filter((v) => v.demo !== undefined).length, DEMOS.length);
  assert.equal(list().length, DEMOS.length + 1);
  const file = backupDatabase('antes.sqlite');
  assert.ok(existsSync(file));
  assert.throws(() => backupDatabase('antes.sqlite'), /já existe/);
  assert.equal(removeNonDemo(), 1);
  assert.equal(removeDemosExcept(DEMOS.map((d) => d.id)), 0);
  assert.deepEqual(
    list().map((v) => v.name),
    DEMOS.map((d) => d.name),
  );
  // Abre pela API como qualquer projeto, na última versão.
  const p = get(DEMOS[0].id);
  assert.equal(p.cursor, p.revisions.length - 1);
});
