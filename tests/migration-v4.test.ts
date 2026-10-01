import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { digest, goldenInputs, snapshotOf } from './fixtures/golden-v3';
import { SCHEMA_VERSION } from '../lib/composition';
import { canonical, normalize } from '../lib/studio';

/**
 * Projeto antigo abre igual: cenas reais do bench, cada ativo nas medidas de
 * ponta e as demos dão as mesmas peças, o mesmo desenho, o mesmo orçamento e
 * o mesmo plano de corte que a v3 dava (retrato em fixtures/golden-v3.json).
 */
const golden = JSON.parse(readFileSync(join(import.meta.dirname, 'fixtures', 'golden-v3.json'), 'utf8')) as Record<string, string>;

void test('v3 migra para v4 sem mudar peça, desenho, orçamento nem corte', () => {
  const inputs = goldenInputs();
  assert.equal(inputs.length, Object.keys(golden).length);
  const changed = inputs.filter(({ name, design }) => digest(snapshotOf(design)) !== golden[name]).map((v) => v.name);
  assert.deepEqual(changed, []);
});

void test('composição v3 gravada vira v4 sem estilo nem acabamento', () => {
  const raw = JSON.parse(readFileSync(join(import.meta.dirname, '..', 'bench', 'scenes', 'painel-rack.json'), 'utf8')).design;
  assert.equal(raw.schemaVersion, 3);
  const d = canonical(normalize(raw));
  assert.equal(d.schemaVersion, SCHEMA_VERSION);
  assert.equal(d.style, undefined);
  assert.ok(d.modules.every((m) => m.look === undefined));
  assert.deepEqual(d.modules.map((m) => m.id), raw.modules.map((m: { id: string }) => m.id));
});
