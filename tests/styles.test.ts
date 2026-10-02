import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyAssetOp, assetById, assets, buildAsset, resolveInput } from '../lib/assets';
import { generateComposition, preset, PROFILE, SCHEMA_VERSION, type Composition, type Module } from '../lib/composition';
import { STYLE_IDS, TOP_OVERHANG_MAX, type StyleId } from '../lib/look';
import { fitReport } from '../lib/room';
import { canonical, describeHighlights, executeRequest, normalize } from '../lib/studio';
import { applyStyle, roleOf, STYLES, styleFrom } from '../lib/styles';
import { tableSpec } from '../lib/tables';

/**
 * Estilos: todo ativo em todo estilo monta e valida no intervalo de medidas,
 * reestilizar guarda o envelope, os estilos são diferentes entre si e a
 * operação do contrato (style.apply) vale para o projeto todo ou uma peça.
 */
const sizes = (a: (typeof assets)[number]) => {
  const { min, max, default: d } = a.size;
  const mid = (k: 'width' | 'height' | 'depth') => Math.round((min[k] + max[k]) / 2);
  return [d, min, max, { width: mid('width'), height: mid('height'), depth: mid('depth') }, { ...d, width: min.width + 137 }];
};
/** Do piso ao topo do módulo: pés, caixa, tampo e moldura (a altura da mesa já é a do tampo). */
const outer = (m: Module) => (m.kind === 'table' ? m.height : (m.feet ?? 0) + m.height + (m.look?.top?.thickness ?? 0) + (m.look?.cornice ? 58 : 0));
const span = (d: Composition, axis: 0 | 1 | 2) => {
  const b = generateComposition(d).bounds;
  return b.max[axis] - b.min[axis];
};

for (const style of STYLE_IDS)
  void test(`estilo ${style}: todo ativo monta em todas as medidas do intervalo`, () => {
    for (const a of assets)
      for (const s of sizes(a)) {
        const d = buildAsset(a, { ...s, style });
        assert.equal(d.style, style);
        // Largura pedida, mais o avanço do tampo nas pontas quando o estilo põe
        // tampo, e o nível de mesa que vai até o pé inclinado, aberto perto do piso.
        const width = span(d, 0);
        const splay = Math.max(0, ...d.modules.filter((m) => m.kind === 'table').map((m) => {
          const t = tableSpec(m);
          return t.levels.length ? 2 * t.levelReach(t.levels[0]) : 0;
        }));
        assert.ok(width >= s.width - 1 && width <= s.width + 2 * TOP_OVERHANG_MAX + splay + 1, `${a.id} ${style} ${JSON.stringify(s)}: largura ${width}`);
        // Nenhuma caixa no piso passa da altura pedida, com pé, tampo e moldura.
        for (const m of d.modules)
          if (!m.kind && !m.wall) assert.ok(outer(m) <= s.height + 1, `${a.id} ${style}: ${m.name} com ${outer(m)} mm`);
        if (a.room) {
          // Como o app monta o ambiente do modelo: pela largura do móvel montado.
          const report = fitReport(d, a.room(resolveInput(a, { ...s, style }), width));
          assert.deepEqual(report.issues.map((i) => i.message), [], `${a.id} ${style} ${JSON.stringify(s)}`);
        }
      }
  });

void test('reestilizar guarda o envelope: altura igual, caixas no mesmo lugar, só o tampo avança', () => {
  for (const a of assets)
    for (const style of STYLE_IDS) {
      const before = buildAsset(a);
      const after = applyStyle(before, style);
      assert.ok(Math.abs(span(before, 1) - span(after, 1)) <= 1, `${a.id} ${style}: altura ${span(before, 1)} → ${span(after, 1)}`);
      for (const m of after.modules) {
        const b = before.modules.find((v) => v.id === m.id)!;
        assert.deepEqual([m.width, m.depth, m.position[0], m.position[2]], [b.width, b.depth, b.position[0], b.position[2]], `${a.id} ${style}: ${m.name}`);
        assert.ok(Math.abs(outer(m) - outer(b)) <= 1, `${a.id} ${style}: ${m.name} ${outer(b)} → ${outer(m)}`);
      }
    }
});

void test('trocar de estilo várias vezes não acumula: volta ao mesmo móvel', () => {
  const a = assetById('aparador')!;
  const industrial = buildAsset(a, { style: 'industrial' });
  const round = applyStyle(applyStyle(applyStyle(industrial, 'classic'), 'japandi'), 'industrial');
  assert.deepEqual(canonical(round).modules, canonical(industrial).modules);
});

/** O que salta aos olhos no móvel: base, puxador, frente e cores. */
function fingerprint(d: Composition) {
  const m = d.modules.find((v) => !v.kind && !v.wall)!;
  let front: string | undefined;
  const walk = (c: Module['root']) => {
    if (c.front && c.front.type === 'drawers') front ??= c.front.materialId;
    c.split?.children.forEach(walk);
  };
  walk(m.root);
  return [m.look?.legs, m.look?.handle, m.look?.front, m.materialId, front ?? m.materialId];
}

void test('os estilos são diferentes entre si em pelo menos dois traços, em três tipos de móvel', () => {
  for (const id of ['aparador', 'criado-mudo', 'comoda']) {
    const prints = STYLE_IDS.map((style) => fingerprint(buildAsset(assetById(id)!, { style })));
    for (let i = 0; i < prints.length; i++)
      for (let j = i + 1; j < prints.length; j++) {
        const differ = prints[i].filter((v, k) => v !== prints[j][k]).length;
        assert.ok(differ >= 2, `${id}: ${STYLE_IDS[i]} × ${STYLE_IDS[j]} só diferem em ${differ}`);
      }
  }
});

void test('papel de cada módulo: baixo, balcão, alto, aéreo, painel', () => {
  const kitchen = buildAsset(assetById('cozinha')!);
  assert.deepEqual([...new Set(kitchen.modules.map((m) => roleOf(kitchen, m)))], ['counter', 'wall']);
  const tv = buildAsset(assetById('rack-suspenso')!);
  assert.deepEqual([...new Set(tv.modules.map((m) => roleOf(tv, m)))], ['panel', 'wall']);
  const shelf = buildAsset(assetById('estante')!);
  assert.equal(roleOf(shelf, shelf.modules[0]), 'tall');
  const nightstand = buildAsset(assetById('criado-mudo')!);
  assert.equal(roleOf(nightstand, nightstand.modules[0]), 'low');
});

void test('o estilo adapta a estrutura: correr e basculante no minimalista, credenza de correr anos 60, estante aberta', () => {
  const types = (d: Composition) => {
    const out: string[] = [];
    const walk = (c: Module['root']) => {
      if (c.front) out.push(c.front.type);
      c.split?.children.forEach(walk);
    };
    for (const m of d.modules) walk(m.root);
    return out;
  };
  const wardrobe = types(buildAsset(assetById('guarda-roupa')!, { style: 'minimalist' }));
  assert.ok(wardrobe.includes('sliding') && wardrobe.includes('flap'), wardrobe.join());
  assert.ok(types(buildAsset(assetById('aparador')!, { style: 'midcentury' })).includes('sliding'));
  assert.ok(types(buildAsset(assetById('aereo-cozinha')!, { style: 'minimalist' })).every((t) => t === 'flap'));
  assert.equal(types(buildAsset(assetById('estante')!, { style: 'scandinavian' })).length, 0);
  assert.ok(types(buildAsset(assetById('estante')!)).length > 0);
});

void test('o estilo grava tudo explícito no módulo e respeita o que a pessoa pediu', () => {
  const a = assetById('aparador')!;
  const d = buildAsset(a, { style: 'midcentury' });
  const m = d.modules[0];
  assert.equal(m.look?.legs, 'splayed');
  assert.equal(m.feet, 200);
  assert.equal(m.materialId, 'walnut');
  // Proporção baixa e comprida do móvel novo, quando a pessoa não deu medida.
  assert.ok(span(d, 0) > a.size.default.width && span(d, 1) < a.size.default.height);
  // Pés e cores pedidos valem no lugar dos do estilo.
  const asked = buildAsset(a, { style: 'midcentury', feet: 120, body: 'oak', front: 'sage', width: 1800, height: 800 });
  assert.equal(asked.modules[0].feet, 120);
  assert.equal(asked.modules[0].look?.legs, 'splayed');
  assert.equal(asked.modules[0].materialId, 'oak');
  const none = buildAsset(a, { style: 'midcentury', feet: 0 });
  assert.ok(none.modules.every((v) => !v.feet && !v.look?.legs));
  // Industrial: portas de tela em quadro de aço, gavetas de madeira.
  const rack = buildAsset(assetById('rack-tv')!, { style: 'industrial' });
  const parts = generateComposition(rack).parts;
  assert.ok(parts.some((p) => p.kind === 'door' && p.materialId === 'steel-black'));
  assert.ok(parts.some((p) => p.kind === 'insert' && p.category === 'metal'));
});

const base = (): Composition => ({
  schemaVersion: SCHEMA_VERSION,
  profile: PROFILE,
  modules: [{ ...preset('niche', 'a'), width: 800, height: 1800, depth: 350 }],
  connections: [],
});

void test('style.apply no contrato: projeto todo, uma peça, ou só a forma', () => {
  const start = normalize(buildAsset(assetById('cozinha')!));
  const all = executeRequest(start, [{ kind: 'style.apply', style: 'rustic' }]);
  assert.ok(all.ok, all.ok ? '' : all.error);
  if (!all.ok) return;
  assert.equal(all.design.style, 'rustic');
  assert.ok(all.design.modules.every((m) => m.materialId === 'pine'));
  // Uma peça: a fileira dela muda junto (painel compartilhado), o resto não.
  const one = executeRequest(start, [{ kind: 'style.apply', style: 'classic', ids: ['a2'] }]);
  assert.ok(one.ok, one.ok ? '' : one.error);
  if (!one.ok) return;
  assert.equal(one.design.style, undefined);
  for (const m of one.design.modules) assert.equal(m.materialId === 'sand', m.id.startsWith('a'), m.id);
  // Só a forma: base, puxador e frentes mudam, as cores ficam.
  const shape = executeRequest(start, [{ kind: 'style.apply', style: 'industrial', keepMaterials: true }]);
  assert.ok(shape.ok, shape.ok ? '' : shape.error);
  if (!shape.ok) return;
  assert.deepEqual(shape.design.modules.map((m) => m.materialId), start.modules.map((m) => m.materialId));
  assert.ok(shape.design.modules.every((m) => m.look?.handle === 'bar'));
  // Cartão de mudança como qualquer edição; módulo que não existe é recusado.
  const [card] = describeHighlights(start, all.design, [{ kind: 'style.apply', style: 'rustic' }]);
  assert.equal(card.title, 'Estilo rústico no projeto');
  assert.equal(card.targets?.length, start.modules.length);
  const missing = executeRequest(start, [{ kind: 'style.apply', style: 'rustic', ids: ['zz'] }]);
  assert.ok(!missing.ok && /zz não encontrado/.test(missing.error));
  // O estilo do projeto sobrevive a salvar e abrir.
  assert.equal(normalize(JSON.parse(JSON.stringify(canonical(all.design))) as Composition).style, 'rustic');
});

void test('asset.add com estilo, e o móvel que entra ao lado segue o estilo do projeto', () => {
  const styled = applyAssetOp(base(), { kind: 'asset.add', asset: 'comoda', style: 'japandi', placement: 'replace' });
  assert.equal(styled.style, 'japandi');
  assert.ok(styled.modules.every((m) => m.look?.front === 'slatted'));
  const beside = applyAssetOp(styled, { kind: 'asset.add', asset: 'criado-mudo', placement: 'right' });
  assert.equal(beside.style, 'japandi');
  assert.ok(beside.modules.every((m) => m.look?.front === 'slatted' && m.materialId === 'ash'));
  const other = applyAssetOp(styled, { kind: 'asset.add', asset: 'criado-mudo', style: 'classic', placement: 'left' });
  assert.equal(other.style, 'japandi');
  assert.ok(other.modules.some((m) => m.look?.front === 'shaker'));
});

void test('palavras da pessoa levam ao estilo', () => {
  const cases: [string, StyleId][] = [
    ['estante industrial', 'industrial'],
    ['aparador anos 60', 'midcentury'],
    ['criado-mudo escandinavo', 'scandinavian'],
    ['cozinha provençal', 'provencal'],
    ['cômoda clássica colonial', 'classic'],
    ['quarto boho com rattan', 'boho'],
    ['rack de freijó com palhinha', 'brazilian'],
    ['aparador modernista brasileiro', 'brazilian'],
    ['sala tropical', 'brazilian'],
    ['bar art déco', 'artdeco'],
    ['buffet glam preto e dourado', 'artdeco'],
    ['criado-mudo francês romântico', 'provencal'],
    ['armário de casa de praia', 'coastal'],
    ['aparador estilo coastal', 'coastal'],
    ['cômoda rústica de fazenda', 'rustic'],
    ['rack japandi ripado', 'japandi'],
    ['guarda-roupa minimalista sem puxador', 'minimalist'],
    ['sala nórdica', 'scandinavian'],
  ];
  for (const [text, style] of cases) assert.equal(styleFrom(text), style, text);
  assert.equal(styleFrom('estante de livros'), null);
  for (const s of Object.values(STYLES)) assert.equal(styleFrom(s.name), s.id);
});
