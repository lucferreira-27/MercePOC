import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { create, get } from '../lib/store';
import { DEFAULT_PRICES } from '../lib/quote';
import { executeRequest, generateDesign, type Design } from '../lib/studio';
import { AgentContext } from '../lib/agent/context';
import { turnMessage } from '../lib/agent/prompt';
import { selectionFacts, selectionLine } from '../lib/agent/snapshot';

process.env.MERCE_DATA_DIR = mkdtempSync(join(tmpdir(), 'merce-selection-'));

/** Estante inicial com dois painéis de parede de larguras diferentes e um nicho com porta. */
function scene() {
  const p = get(create().id);
  const r = executeRequest(p.revisions[0].params, [
    { kind: 'module.add', id: 'faixa', preset: 'panel', name: 'Faixa superior' },
    { kind: 'module.edit', id: 'faixa', width: 1900, height: 200, depth: 18, position: [2000, 1800, 0] },
    { kind: 'module.add', id: 'painel', preset: 'panel', name: 'Painel da TV' },
    { kind: 'module.edit', id: 'painel', width: 2000, height: 1050, depth: 18, position: [2000, 700, 0] },
    { kind: 'module.add', id: 'n', preset: 'niche', name: 'Nicho' },
    { kind: 'front.set', id: 'n:root', type: 'single' },
  ]);
  assert.ok(r.ok, !r.ok ? r.error : '');
  p.revisions[0].params = (r as { design: Design }).design;
  return p;
}

void test('seleção: cada item com o nome da tela e o módulo com as medidas', () => {
  const p = scene();
  const d = p.revisions[0].params;
  const panel = generateDesign(d).parts.find((v) => v.owners.includes('faixa'))!;
  const front = d.modules.find((m) => m.id === 'n')!.root.front!.id;
  const facts = selectionFacts(d, [panel.id, 'painel', 'n:root', front, 'sumiu']);
  assert.deepEqual(
    facts.map((f) => [f.id, f.modulos.map((m) => m.id)]),
    [
      [panel.id, ['faixa']],
      ['painel', ['painel']],
      ['n:root', ['n']],
      [front, ['n']],
    ],
    'peça, módulo, compartimento e frente; id que não existe fica fora',
  );
  assert.deepEqual([facts[0].modulos[0].largura, facts[0].modulos[0].altura], [1900, 200]);
  assert.equal(facts[0].nome, panel.name, 'o mesmo nome do chip da seleção');
  assert.equal(facts[1].nome, 'Painel da TV');
  assert.ok(facts[2].vao_mm, 'compartimento traz o vão');
  assert.equal(facts[3].frente, 'single');
  assert.equal(selectionLine(d, []), '');
  assert.equal(selectionLine(d, ['sumiu']), '');
});

void test('seleção vai colada no pedido; sem seleção o pedido fica como antes', () => {
  const p = scene();
  const d = p.revisions[0].params;
  const panel = generateDesign(d).parts.find((v) => v.owners.includes('faixa'))!;
  const request = 'deixe esses dois com a mesma largura, aumente o menor';
  const withSel = turnMessage(new AgentContext(p, p.version, DEFAULT_PRICES, request, [panel.id, 'painel'], null), false, request);
  const lines = withSel.split('\n');
  assert.match(lines.at(-2)!, /^Selecionado na tela \(2\): .*Faixa superior.*1900 × 200 × 18 mm.*Painel da TV.*2000 × 1050 × 18 mm.*"esses"/);
  assert.equal(lines.at(-1), `Pedido: ${request}`);
  const none = turnMessage(new AgentContext(p, p.version, DEFAULT_PRICES, request, [], null), false, request);
  assert.ok(!none.includes('Selecionado na tela'));
  assert.ok(none.endsWith(`\n\nPedido: ${request}`), 'sem seleção, o texto não muda');
});
